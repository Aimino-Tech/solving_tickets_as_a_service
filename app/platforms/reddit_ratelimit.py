"""Reddit rate limiting, backoff, and IP-ban handling for Hermes marketing campaigns.

Provides:
    - RedditRateLimiter: exponential backoff + jitter for PRAW API calls.
    - handle_http_error(): map HTTP status codes to retry delays.
    - rotate_user_agent(): cycle through realistic user-agent strings.
    - RedditProxyPool: manage a list of SOCKS/HTTP proxies for IP rotation.
    - parse_ratelimit_headers(): read ``x-ratelimit-*`` response headers.
    - RedditBanAlert: callback registry for ban/block alerting.
    - init_proxy_pool_from_env(): populate proxy pool from environment.
"""

from __future__ import annotations

import itertools
import logging
import os
import random
import time
from dataclasses import dataclass
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default backoff configuration
DEFAULT_MAX_RETRIES = 5
DEFAULT_BASE_DELAY = 2.0  # seconds
DEFAULT_MAX_DELAY = 300.0  # 5 minutes
DEFAULT_JITTER_FACTOR = 0.1  # ±10% jitter

# HTTP status codes that warrant a retry with backoff
STATUS_RATE_LIMITED = 429       # Too Many Requests
STATUS_FORBIDDEN = 403          # Forbidden / IP banned
STATUS_SERVER_ERRORS = {500, 502, 503, 504}  # transient server errors

# Known PRAW exception messages that indicate rate-limiting / banning
PRAW_RATE_LIMIT_KEYWORDS = [
    "RATELIMIT",
    "too many requests",
    "try again later",
    "slow down",
    "your request has been blocked",
    "forbidden",
    "banned",
    "access denied",
]

# Reddit API rate limit header names
HEADER_RATELIMIT_USED = "x-ratelimit-used"
HEADER_RATELIMIT_REMAINING = "x-ratelimit-remaining"
HEADER_RATELIMIT_RESET = "x-ratelimit-reset"

# Default retry-after bounds when the header is missing
DEFAULT_RETRY_AFTER_RATELIMIT = 60.0
DEFAULT_RETRY_AFTER_BAN = 300.0
DEFAULT_RETRY_AFTER_SERVER_ERROR = 30.0

# ---------------------------------------------------------------------------
# User-Agent pool for rotation
# ---------------------------------------------------------------------------

DEFAULT_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile/Safari/537.36",
]


def rotate_user_agent(agent_pool: Optional[list[str]] = None) -> str:
    """Return a random user-agent from the pool and log the selection."""
    pool = agent_pool or DEFAULT_USER_AGENTS
    ua = random.choice(pool)
    logger.debug("Rotated user-agent: %s ...", ua[:60])
    return ua


# ---------------------------------------------------------------------------
# Rate limit header parsing
# ---------------------------------------------------------------------------


@dataclass
class RatelimitHeaders:
    """Parsed Reddit API rate-limit response headers."""
    used: float = 0.0
    remaining: float = 60.0
    reset: float = 60.0


def parse_ratelimit_headers(
    response_headers: Optional[dict[str, str]] = None,
) -> RatelimitHeaders:
    """Extract Reddit API rate-limit headers from a response.

    Reddit sends three ``x-ratelimit-*`` headers on every API response::

        x-ratelimit-used: 5
        x-ratelimit-remaining: 55
        x-ratelimit-reset: 532

    Args:
        response_headers: Dict of response headers (case-insensitive lookup).

    Returns:
        A ``RatelimitHeaders`` dataclass. Missing/empty headers default to
        safe fallback values.
    """
    headers = {}
    if response_headers:
        for k, v in response_headers.items():
            headers[k.lower()] = v

    def _safe_float(key: str, default: float) -> float:
        val = headers.get(key, "")
        try:
            return float(val)
        except (ValueError, TypeError):
            return default

    return RatelimitHeaders(
        used=_safe_float(HEADER_RATELIMIT_USED, 0.0),
        remaining=_safe_float(HEADER_RATELIMIT_REMAINING, 60.0),
        reset=_safe_float(HEADER_RATELIMIT_RESET, 60.0),
    )


def get_retry_after_from_headers(
    response_headers: Optional[dict[str, str]] = None,
    status_code: int = 429,
) -> float:
    """Determine retry-after delay from response headers or a sensible default.

    Precedence:
        1. ``Retry-After`` header (RFC 7231).
        2. ``x-ratelimit-reset`` header (Reddit-specific).
        3. Default based on the status code.
    """
    headers = {}
    if response_headers:
        for k, v in response_headers.items():
            headers[k.lower()] = v

    # 1. Standard Retry-After header
    retry_after = headers.get("retry-after", headers.get("retry-after-ms"))
    if retry_after:
        try:
            return float(retry_after)
        except (ValueError, TypeError):
            pass

    # 2. Reddit x-ratelimit-reset — only use if a real reset value was provided
    #    (parse_ratelimit_headers defaults to 60.0, so we check that actual
    #    header was present by comparing against the default).
    rl = parse_ratelimit_headers(response_headers)
    if rl.reset > 0 and response_headers and "x-ratelimit-reset" in {
        k.lower() for k in response_headers
    }:
        return rl.reset

    # 3. Defaults
    if status_code == STATUS_RATE_LIMITED:
        return DEFAULT_RETRY_AFTER_RATELIMIT
    if status_code == STATUS_FORBIDDEN:
        return DEFAULT_RETRY_AFTER_BAN
    if status_code in STATUS_SERVER_ERRORS:
        return DEFAULT_RETRY_AFTER_SERVER_ERROR
    return DEFAULT_RETRY_AFTER_RATELIMIT


# ---------------------------------------------------------------------------
# Ban alert callback system
# ---------------------------------------------------------------------------


class RedditBanAlert:
    """Registry for callbacks that fire when a ban or block is detected.

    Usage::

        def slack_alert(msg: str) -> None:
            slack_client.chat_postMessage(channel="#ops", text=msg)

        alert = RedditBanAlert()
        alert.register(slack_alert)
        alert.fire("IP banned on Reddit", operation="search", status_code=403)
    """

    def __init__(self) -> None:
        self._callbacks: list[Callable[[str], None]] = []

    def register(self, callback: Callable[[str], None]) -> None:
        """Register a callback to fire on ban/block events."""
        self._callbacks.append(callback)

    def unregister(self, callback: Callable[[str], None]) -> None:
        """Remove a previously registered callback."""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def fire(self, message: str, **context: object) -> None:
        """Invoke all registered callbacks with *message*."""
        logger.warning("BAN ALERT: %s | context=%s", message, context)
        for cb in self._callbacks:
            try:
                cb(message)
            except Exception as exc:
                logger.error("Ban alert callback failed: %s", exc)

    @property
    def callback_count(self) -> int:
        """Number of registered callbacks."""
        return len(self._callbacks)


# Shared global ban alert instance
reddit_ban_alert = RedditBanAlert()


# ---------------------------------------------------------------------------
# Proxy pool
# ---------------------------------------------------------------------------


@dataclass
class Proxy:
    """A single proxy entry."""
    url: str
    latency_ms: float = 0.0
    is_alive: bool = True
    last_used: float = 0.0
    failure_count: int = 0


class RedditProxyPool:
    """Manages a pool of proxies for IP rotation in Reddit API calls.

    Proxies are rotated round-robin and can be marked dead after repeated
    failures.
    """

    def __init__(
        self,
        proxies: Optional[list[str]] = None,
        max_failures: int = 3,
        cooldown_seconds: float = 300.0,
    ) -> None:
        self._proxies: list[Proxy] = [Proxy(url=u) for u in (proxies or [])]
        self._max_failures = max_failures
        self._cooldown_seconds = cooldown_seconds
        self._cycle = itertools.cycle(range(len(self._proxies))) if self._proxies else itertools.cycle([])

    @property
    def has_proxies(self) -> bool:
        return len(self._proxies) > 0

    @property
    def alive_count(self) -> int:
        return sum(1 for p in self._proxies if p.is_alive)

    def add_proxy(self, proxy_url: str) -> None:
        self._proxies.append(Proxy(url=proxy_url))
        self._cycle = itertools.cycle(range(len(self._proxies)))

    def remove_proxy(self, proxy_url: str) -> None:
        self._proxies = [p for p in self._proxies if p.url != proxy_url]
        self._cycle = itertools.cycle(range(len(self._proxies))) if self._proxies else itertools.cycle([])

    def get_next_proxy(self) -> Optional[str]:
        for _ in range(len(self._proxies) * 2):
            try:
                idx = next(self._cycle)
            except StopIteration:
                return None
            proxy = self._proxies[idx]
            now = time.time()
            if not proxy.is_alive and (now - proxy.last_used) >= self._cooldown_seconds:
                logger.info("Reviving proxy %s after cooldown", proxy.url[:40])
                proxy.is_alive = True
                proxy.failure_count = 0
            if proxy.is_alive:
                proxy.last_used = now
                return proxy.url
        logger.warning("All %d proxies in pool are dead", len(self._proxies))
        return None

    def mark_failure(self, proxy_url: str) -> None:
        for proxy in self._proxies:
            if proxy.url == proxy_url:
                proxy.failure_count += 1
                proxy.last_used = time.time()
                if proxy.failure_count >= self._max_failures:
                    proxy.is_alive = False
                    logger.warning("Proxy %s marked dead after %d failures", proxy_url[:40], proxy.failure_count)
                break

    def mark_success(self, proxy_url: str) -> None:
        for proxy in self._proxies:
            if proxy.url == proxy_url:
                proxy.failure_count = 0
                proxy.is_alive = True
                break

    def list_proxies(self) -> list[dict]:
        return [
            {
                "url": p.url,
                "latency_ms": p.latency_ms,
                "is_alive": p.is_alive,
                "failure_count": p.failure_count,
            }
            for p in self._proxies
        ]


def init_proxy_pool_from_env(
    pool: Optional[RedditProxyPool] = None,
    env_var: str = "REDDIT_PROXY_URLS",
    max_failures_env: str = "REDDIT_PROXY_MAX_FAILURES",
    cooldown_env: str = "REDDIT_PROXY_COOLDOWN",
) -> RedditProxyPool:
    """Populate a ``RedditProxyPool`` from environment variables.

    The *env_var* should contain a comma- or newline-separated list of
    proxy URLs::

        REDDIT_PROXY_URLS=socks5://user:pass@1.2.3.4:1080,http://5.6.7.8:3128
    """
    if pool is None:
        pool = RedditProxyPool()

    raw = os.getenv(env_var, "")
    if raw:
        urls = [u.strip() for u in raw.replace("\n", ",").split(",") if u.strip()]
        for url in urls:
            pool.add_proxy(url)
        logger.info("Loaded %d proxies from %s", len(urls), env_var)

    max_failures = os.getenv(max_failures_env)
    cooldown = os.getenv(cooldown_env)
    if max_failures:
        try:
            pool._max_failures = int(max_failures)
        except ValueError:
            logger.warning("Invalid %s: %s", max_failures_env, max_failures)
    if cooldown:
        try:
            pool._cooldown_seconds = float(cooldown)
        except ValueError:
            logger.warning("Invalid %s: %s", cooldown_env, cooldown)

    return pool


# ---------------------------------------------------------------------------
# HTTP error handler
# ---------------------------------------------------------------------------


def handle_http_error(
    status_code: int,
    error_msg: str = "",
    response_headers: Optional[dict[str, str]] = None,
) -> Optional[float]:
    """Examine an HTTP status code and return a recommended retry delay (seconds),
    or ``None`` if the error is not retryable.
    """
    error_lower = error_msg.lower()

    if status_code == STATUS_RATE_LIMITED:
        delay = get_retry_after_from_headers(response_headers, status_code)
        logger.warning("HTTP 429 (Rate Limited): %s | retry-after=%.1fs", error_msg[:200], delay)
        return delay

    if status_code == STATUS_FORBIDDEN:
        if any(kw in error_lower for kw in ["banned", "blocked", "forbidden", "access denied"]):
            delay = get_retry_after_from_headers(response_headers, status_code)
            logger.warning("HTTP 403 (IP Banned / Blocked): %s | retry-after=%.1fs", error_msg[:200], delay)
            reddit_ban_alert.fire(
                f"Reddit IP ban detected (status=403, delay={delay:.0f}s)",
                status_code=status_code,
                error_msg=error_msg[:200],
            )
            return delay
        logger.warning("HTTP 403 (Not retryable): %s", error_msg[:200])
        return None

    if status_code in STATUS_SERVER_ERRORS:
        delay = get_retry_after_from_headers(response_headers, status_code)
        logger.warning("HTTP %d (Server Error): %s | retry-after=%.1fs", status_code, error_msg[:200], delay)
        return delay

    logger.warning("HTTP %d (Not retryable): %s", status_code, error_msg[:200])
    return None


def is_rate_limit_error(exception: Exception) -> bool:
    """Check if a PRAW or HTTP exception indicates a rate-limit or ban."""
    msg = str(exception).lower()
    for keyword in PRAW_RATE_LIMIT_KEYWORDS:
        if keyword.lower() in msg:
            return True
    if hasattr(exception, "status_code"):
        code = exception.status_code
        if code in (STATUS_RATE_LIMITED, STATUS_FORBIDDEN):
            return True
    if hasattr(exception, "response") and hasattr(exception.response, "status_code"):
        code = exception.response.status_code
        if code in (STATUS_RATE_LIMITED, STATUS_FORBIDDEN):
            return True
    return False


# ---------------------------------------------------------------------------
# Rate limiter with exponential backoff + jitter
# ---------------------------------------------------------------------------


@dataclass
class BackoffState:
    """Tracks retry state for a single operation."""
    attempt: int = 0
    last_delay: float = 0.0
    next_retry_at: float = 0.0


class RedditRateLimiter:
    """Exponential backoff with jitter for Reddit API calls.

    Usage::

        limiter = RedditRateLimiter()
        for attempt in limiter.retry_attempts():
            with attempt:
                reddit.subreddit("test").hot(limit=10)
    """

    def __init__(
        self,
        max_retries: int = DEFAULT_MAX_RETRIES,
        base_delay: float = DEFAULT_BASE_DELAY,
        max_delay: float = DEFAULT_MAX_DELAY,
        jitter_factor: float = DEFAULT_JITTER_FACTOR,
    ) -> None:
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.jitter_factor = jitter_factor
        self._state: dict[str, BackoffState] = {}

    def compute_delay(self, attempt: int) -> float:
        delay = self.base_delay * (2 ** attempt)
        delay = min(delay, self.max_delay)
        jitter = delay * self.jitter_factor * random.uniform(-1.0, 1.0)
        return delay + jitter

    def get_retry_delay(self, operation_id: str = "default") -> float:
        if operation_id not in self._state:
            self._state[operation_id] = BackoffState()
        state = self._state[operation_id]
        state.attempt += 1
        delay = self.compute_delay(state.attempt - 1)
        state.last_delay = delay
        state.next_retry_at = time.time() + delay
        return delay

    def reset(self, operation_id: str = "default") -> None:
        self._state.pop(operation_id, None)

    def reset_all(self) -> None:
        self._state.clear()

    def retry_attempts(self, operation_id: str = "default"):
        return _RetryAttempts(self, operation_id)

    def sleep_if_needed(self, operation_id: str = "default") -> None:
        state = self._state.get(operation_id)
        if state is None:
            return
        remaining = state.next_retry_at - time.time()
        if remaining > 0:
            logger.debug("Rate limiter sleeping %.1f s for %s", remaining, operation_id)
            time.sleep(remaining)

    @property
    def state_snapshot(self) -> dict[str, dict]:
        return {
            op: {
                "attempt": s.attempt,
                "last_delay": s.last_delay,
                "next_retry_at": s.next_retry_at,
                "remaining": max(0.0, s.next_retry_at - time.time()),
            }
            for op, s in self._state.items()
        }


class _RetryAttempts:
    """Internal generator for retry loops."""

    def __init__(self, limiter: RedditRateLimiter, operation_id: str):
        self._limiter = limiter
        self._operation_id = operation_id
        self._attempt = 0
        self._max = limiter.max_retries

    def __iter__(self):
        return self

    def __next__(self):
        if self._attempt >= self._max:
            raise StopIteration
        ctx = _RetryContext(self._limiter, self._operation_id, self._attempt)
        self._attempt += 1
        return ctx


class _RetryContext:
    """Context manager wrapping a single retry attempt."""

    def __init__(self, limiter: RedditRateLimiter, operation_id: str, attempt: int):
        self._limiter = limiter
        self._operation_id = operation_id
        self.attempt = attempt
        self.exception: Optional[Exception] = None

    def __enter__(self):
        if self.attempt > 0:
            delay = self._limiter.get_retry_delay(self._operation_id)
            logger.info(
                "Retry %d/%d for %s -- sleeping %.1f s",
                self.attempt + 1,
                self._limiter.max_retries,
                self._operation_id,
                delay,
            )
            time.sleep(delay)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        if exc_type is None:
            self._limiter.reset(self._operation_id)
            return False
        if is_rate_limit_error(exc_val):
            self.exception = exc_val
            logger.warning(
                "Rate limit / ban on attempt %d for %s: %s",
                self.attempt + 1,
                self._operation_id,
                exc_val,
            )
            return True
        return False


# ---------------------------------------------------------------------------
# Convenience: PRAW call wrapper
# ---------------------------------------------------------------------------


def call_with_backoff(
    fn: Callable,
    *args,
    limiter: Optional[RedditRateLimiter] = None,
    operation_id: str = "default",
    **kwargs,
):
    """Execute a callable with automatic exponential backoff on rate-limit errors.

    Usage::

        result = call_with_backoff(reddit.subreddit("test").hot, limit=10)

    Raises:
        The last exception caught if all retries are exhausted.
    """
    if limiter is None:
        limiter = RedditRateLimiter()
    last_exc: Optional[Exception] = None
    for attempt in limiter.retry_attempts(operation_id):
        with attempt:
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                if is_rate_limit_error(e):
                    last_exc = e
                    raise
                raise
    if last_exc is not None:
        logger.error(
            "All %d retries exhausted for %s: %s",
            limiter.max_retries,
            operation_id,
            last_exc,
        )
        raise last_exc
    return None


# ---------------------------------------------------------------------------
# Named global instances (convenience)
# ---------------------------------------------------------------------------

# Shared rate limiter for Reddit API calls
reddit_rate_limiter = RedditRateLimiter()

# Shared proxy pool (empty by default -- populate via env or config)
reddit_proxy_pool = RedditProxyPool()

# Populate proxy pool from environment on import
init_proxy_pool_from_env(pool=reddit_proxy_pool)
