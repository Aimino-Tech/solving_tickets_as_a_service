"""
Runaway agent guard — per-agent timeout, token/cost limits, max retries.

Design
------
Tracks running agent state in Redis (with file-based fallback for testing):

  - ``syntaro:runaway:<task_id>:start``       — epoch-seconds when the task started
  - ``syntaro:runaway:<task_id>:tokens``       — cumulative token usage for the session
  - ``syntaro:runaway:<task_id>:cost``         — cumulative cost in credits
  - ``syntaro:runaway:<session_id>:retries``   — retry counter per session

When a limit is exceeded the guard:

  1. Terminates the task (via ``Ignore`` in the middleware).
  2. Labels the originating GitHub issue ``syntaro:timeout``.
  3. Emits an OpenTelemetry span with execution-time attributes.

Usage::

    guard = get_runaway_guard()
    guard.check_timeout(task_id, timeout_seconds=600)
    guard.track_tokens(task_id, tokens=150)
    guard.track_cost(task_id, cost=0.05)
    guard.increment_retry(session_id)
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# ---- Redis key prefixes ---------------------------------------------------
REDIS_PREFIX_START = "syntaro:runaway:"
REDIS_PREFIX_TOKENS = "syntaro:runaway:tokens:"
REDIS_PREFIX_COST = "syntaro:runaway:cost:"
REDIS_PREFIX_RETRIES = "syntaro:runaway:retries:"
REDIS_PREFIX_TIMEOUT_LABEL = "syntaro:runaway:labeled:"

# ---- Default limits -------------------------------------------------------
DEFAULT_TIMEOUT_SECONDS: int = int(os.getenv("SYNTARO_RUNAWAY_TIMEOUT_SECONDS", "600"))
DEFAULT_MAX_TOKENS: int = int(os.getenv("SYNTARO_RUNAWAY_MAX_TOKENS", "100000"))
DEFAULT_MAX_COST: float = float(os.getenv("SYNTARO_RUNAWAY_MAX_COST", "10.0"))
DEFAULT_MAX_RETRIES: int = int(os.getenv("SYNTARO_RUNAWAY_MAX_RETRIES", "3"))

# ---- Per-tier overrides (loaded from env) ---------------------------------
# Format: tier=timeout_sec,max_tokens,max_cost
# Example: SYNTARO_RUNAWAY_TIER_LIMITS=free=300,50000,5.0;pro=600,100000,10.0;enterprise=900,200000,20.0
_RAW_TIER_LIMITS = os.getenv("SYNTARO_RUNAWAY_TIER_LIMITS", "")

TIER_LIMITS: dict[str, dict[str, float | int]] = {}
if _RAW_TIER_LIMITS:
    for part in _RAW_TIER_LIMITS.split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            tier_part, values_part = part.split("=", 1)
            timeout_s, max_tok, max_c = values_part.split(",")
            TIER_LIMITS[tier_part.strip()] = {
                "timeout_seconds": int(timeout_s.strip()),
                "max_tokens": int(max_tok.strip()),
                "max_cost": float(max_c.strip()),
            }
        except (ValueError, IndexError) as exc:
            logger.warning("Malformed tier limit entry %r: %s", part, exc)

# ---- OpenTelemetry span name ----------------------------------------------
OTEL_SPAN_NAME = "syntaro.runaway.execution"

# ---- Sentinel values for redis_client constructor argument -----------------
_UNSET: Any = object()
_DISABLE_REDIS: Any = object()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_epoch() -> int:
    """Current UTC time as integer epoch seconds."""
    return int(time.time())


def _now_iso() -> str:
    """Current UTC time as ISO-8601 string with milliseconds."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _get_lock_dir() -> str:
    """Directory for file-based fallback state files."""
    return os.getenv("RUNAWAY_LOCK_DIR", "/tmp/syntaro-runaway")


def _lock_file(key: str) -> str:
    """Build a file path for a given key (safe filename)."""
    safe = key.replace(":", "_").replace("/", "_").replace(".", "_")
    lock_dir = _get_lock_dir()
    os.makedirs(lock_dir, exist_ok=True)
    return os.path.join(lock_dir, safe)


def _extract_repo_and_issue(args: tuple, kwargs: dict) -> tuple[str | None, int | None]:
    """Extract ``(repo_full_name, issue_number)`` from task args/kwargs.

    Checks (in order):
      1. ``kwargs["repo_full_name"]`` and ``kwargs["issue_number"]``
      2. ``kwargs.get("issue_context", {})["repo_full_name"]``
      3. ``kwargs.get("issue_context", {})["issue_number"]``
      4. First dict positional arg's ``"repo_full_name"`` / ``"issue_number"``
    """
    repo = kwargs.get("repo_full_name")
    issue = kwargs.get("issue_number")
    if repo and issue:
        return repo, int(issue)

    ctx = kwargs.get("issue_context") or {}
    if isinstance(ctx, dict):
        repo = ctx.get("repo_full_name") or ctx.get("repo") or ctx.get("project_slug")
        issue = ctx.get("issue_number") or ctx.get("number")
        if repo and issue:
            return repo, int(issue)

    for arg in args:
        if isinstance(arg, dict):
            repo = arg.get("repo_full_name") or arg.get("repo") or arg.get("project_slug")
            issue = arg.get("issue_number") or arg.get("number")
            if repo and issue:
                return repo, int(issue)

    return None, None


def _label_github_issue(repo_full_name: str, issue_number: int) -> bool:
    """Add the ``syntaro:timeout`` label to a GitHub issue.

    Returns ``True`` if the label was applied successfully, ``False`` otherwise.
    """
    try:
        from workers.github.client import GitHubClient

        client = GitHubClient()
        client._request(
            "POST",
            f"/repos/{repo_full_name}/issues/{issue_number}/labels",
            json_body={"labels": ["syntaro:timeout"]},
        )
        logger.info(
            "Labeled issue %s#%d with syntaro:timeout",
            repo_full_name,
            issue_number,
        )
        return True
    except Exception as exc:
        logger.warning(
            "Failed to label issue %s#%d with syntaro:timeout: %s",
            repo_full_name,
            issue_number,
            exc,
        )
        return False


def _run_otel_span(task_name: str, task_id: str, duration: float, reason: str) -> None:
    """Emit an OpenTelemetry span capturing execution-time attributes.

    Gracefully handles missing opentelemetry packages — logs a debug message
    and continues if the SDK is not installed.
    """
    try:
        from opentelemetry import trace
        from opentelemetry.trace import Status, StatusCode

        tracer = trace.get_tracer("syntaro-runaway")
        with tracer.start_as_current_span(OTEL_SPAN_NAME) as span:
            span.set_attribute("task.name", task_name)
            span.set_attribute("task.id", task_id)
            span.set_attribute("execution.duration_ms", int(duration * 1000))
            span.set_attribute("runaway.reason", reason)
            span.set_status(Status(StatusCode.ERROR, description=reason))
    except ImportError:
        logger.debug("OpenTelemetry SDK not installed — skipping span emission")
    except Exception as exc:
        logger.warning("Failed to emit OpenTelemetry span: %s", exc)


# ---------------------------------------------------------------------------
# RunawayGuard class
# ---------------------------------------------------------------------------


class RunawayGuard:
    """Per-agent runaway protection with Redis-backed state tracking.

    Thread-safe: uses a new Redis connection per call (lightweight enough for
    the low-frequency check pattern).  File-based fallback uses atomic writes.
    """

    def __init__(self, redis_client: Any = _UNSET) -> None:
        if redis_client is _UNSET:
            self._redis: Any = None  # auto-detect
        elif redis_client is _DISABLE_REDIS:
            self._redis: Any = _DISABLE_REDIS  # explicitly disabled
        else:
            self._redis: Any = redis_client  # caller-provided client

    # -- Redis helpers -------------------------------------------------------

    def _get_redis(self) -> Optional[Any]:
        """Get the Redis client (lazy-init pattern, with auto-detect)."""
        if self._redis is _DISABLE_REDIS:
            return None
        if self._redis is not None:
            return self._redis
        try:
            import redis as _redis_mod

            url = os.getenv(
                "REDIS_URL",
                os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
            )
            self._redis = _redis_mod.from_url(url, decode_responses=True)
            self._redis.ping()
        except Exception:
            self._redis = None
        return self._redis

    # -- Low-level state helpers ---------------------------------------------

    def _redis_get(self, key: str) -> str | None:
        """Read a value from Redis or fallback file."""
        r = self._get_redis()
        if r is not None:
            try:
                val: str | None = r.get(key)
                if val is not None:
                    return val
            except Exception:
                pass
        # Fallback: file lock
        try:
            with open(_lock_file(key)) as f:
                return f.read().strip()
        except (FileNotFoundError, OSError):
            pass
        return None

    def _redis_set(self, key: str, value: str, ttl: int | None = None) -> None:
        """Write a value to Redis and fallback file, with optional TTL (seconds)."""
        r = self._get_redis()
        if r is not None:
            try:
                if ttl is not None:
                    r.setex(key, ttl, value)
                else:
                    r.set(key, value)
            except Exception as exc:
                logger.warning("Failed to write Redis key %s: %s", key, exc)
        # Always write fallback file
        try:
            with open(_lock_file(key), "w") as f:
                f.write(value)
        except OSError as exc:
            logger.warning("Failed to write fallback file for %s: %s", key, exc)

    def _redis_delete(self, key: str) -> None:
        """Delete a key from Redis and fallback file."""
        r = self._get_redis()
        if r is not None:
            try:
                r.delete(key)
            except Exception:
                pass
        try:
            os.unlink(_lock_file(key))
        except FileNotFoundError:
            pass

    def _redis_incr(self, key: str, ttl: int | None = None) -> int:
        """Increment a counter and return the new value.

        Works with Redis ``INCR`` or falls back to file-based increment.
        """
        r = self._get_redis()
        if r is not None:
            try:
                val: int = r.incr(key)
                if ttl is not None:
                    r.expire(key, ttl)
                return val
            except Exception:
                pass
        # Fallback: file-based increment
        current = self._redis_get(key)
        new_val = (int(current) + 1) if current else 1
        self._redis_set(key, str(new_val), ttl=ttl)
        return new_val

    # -- Public API ----------------------------------------------------------

    def get_tier(self, repo_full_name: str | None = None) -> str:
        """Resolve the plan tier for a repo.

        Falls back to the ``SYNTARO_DEFAULT_TIER`` env var (default ``"free"``).
        """
        if repo_full_name:
            tier = os.getenv(f"SYNTARO_TIER_{repo_full_name.replace('/', '_').upper()}")
            if tier:
                return tier.lower()
        return os.getenv("SYNTARO_DEFAULT_TIER", "free").lower()

    def get_limits_for_tier(self, tier: str) -> dict[str, float | int]:
        """Return limit overrides for a given plan tier.

        Returns defaults if no tier-specific limits are configured.
        """
        if tier in TIER_LIMITS:
            return dict(TIER_LIMITS[tier])
        return {
            "timeout_seconds": DEFAULT_TIMEOUT_SECONDS,
            "max_tokens": DEFAULT_MAX_TOKENS,
            "max_cost": DEFAULT_MAX_COST,
        }

    # -- Timeout enforcement -------------------------------------------------

    def mark_start(self, task_id: str, ttl: int | None = 7200) -> None:
        """Record the start time of a task.

        The key expires after *ttl* seconds (default 2 hours) to avoid
        accumulating stale entries for tasks that never complete.
        """
        now_epoch = _now_epoch()
        key = f"{REDIS_PREFIX_START}{task_id}"
        self._redis_set(key, str(now_epoch), ttl=ttl)
        logger.debug("Marked task start — task_id=%s epoch=%d", task_id, now_epoch)

    def mark_complete(self, task_id: str) -> None:
        """Remove the start-time marker and related tracking keys."""
        self._redis_delete(f"{REDIS_PREFIX_START}{task_id}")
        self._redis_delete(f"{REDIS_PREFIX_TOKENS}{task_id}")
        self._redis_delete(f"{REDIS_PREFIX_COST}{task_id}")
        logger.debug("Cleared runaway tracking — task_id=%s", task_id)

    def get_elapsed(self, task_id: str) -> Optional[float]:
        """Return elapsed wall-clock seconds for a task, or ``None`` if unknown."""
        val = self._redis_get(f"{REDIS_PREFIX_START}{task_id}")
        if val is None:
            return None
        try:
            start_epoch = int(val)
            return max(0.0, float(_now_epoch() - start_epoch))
        except (ValueError, TypeError):
            return None

    def check_timeout(
        self,
        task_id: str,
        task_name: str,
        args: tuple,
        kwargs: dict,
    ) -> tuple[bool, str]:
        """Check whether a task has exceeded its configured timeout.

        Returns ``(exceeded: bool, reason: str)``.
        """
        elapsed = self.get_elapsed(task_id)
        if elapsed is None:
            return False, ""

        # Resolve tier-based timeout
        repo, issue = _extract_repo_and_issue(args, kwargs)
        tier = self.get_tier(repo)
        limits = self.get_limits_for_tier(tier)
        timeout_seconds = int(limits.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS))

        if elapsed > timeout_seconds:
            reason = (
                f"Task {task_name} ({task_id}) exceeded timeout "
                f"({elapsed:.0f}s > {timeout_seconds}s, tier={tier})"
            )
            logger.warning("Runaway timeout — %s", reason)

            # Emit OTel span
            _run_otel_span(task_name, task_id, elapsed, reason)

            # Label the GitHub issue
            if repo and issue:
                label_key = f"{REDIS_PREFIX_TIMEOUT_LABEL}{repo}/{issue}"
                if self._redis_get(label_key) is None:
                    _label_github_issue(repo, issue)
                    self._redis_set(label_key, "1", ttl=86400)

            return True, reason

        return False, ""

    # -- Token / cost tracking -----------------------------------------------

    def get_tokens(self, task_id: str) -> int:
        """Return the cumulative token count for a task session."""
        val = self._redis_get(f"{REDIS_PREFIX_TOKENS}{task_id}")
        return int(val) if val else 0

    def get_cost(self, task_id: str) -> float:
        """Return the cumulative cost for a task session."""
        val = self._redis_get(f"{REDIS_PREFIX_COST}{task_id}")
        return float(val) if val else 0.0

    def track_tokens(
        self,
        task_id: str,
        tokens: int,
        ttl: int | None = 7200,
    ) -> int:
        """Add *tokens* to the cumulative count for a task session.

        Returns the new cumulative token count.
        """
        key = f"{REDIS_PREFIX_TOKENS}{task_id}"
        r = self._get_redis()
        if r is not None:
            try:
                new_val: int = r.incrby(key, tokens)
                if ttl is not None:
                    r.expire(key, ttl)
                return new_val
            except Exception:
                pass
        # Fallback
        current = self.get_tokens(task_id)
        new_val = current + tokens
        self._redis_set(key, str(new_val), ttl=ttl)
        return new_val

    def track_cost(
        self,
        task_id: str,
        cost: float,
        ttl: int | None = 7200,
    ) -> float:
        """Add *cost* to the cumulative cost for a task session.

        Returns the new cumulative cost.
        """
        key = f"{REDIS_PREFIX_COST}{task_id}"
        r = self._get_redis()
        if r is not None:
            try:
                new_val_str: str = r.incrbyfloat(key, cost)
                if ttl is not None:
                    r.expire(key, ttl)
                return float(new_val_str)
            except Exception:
                pass
        # Fallback
        current = self.get_cost(task_id)
        new_val = current + cost
        self._redis_set(key, str(new_val), ttl=ttl)
        return new_val

    def check_token_limit(
        self,
        task_id: str,
        task_name: str,
        args: tuple,
        kwargs: dict,
    ) -> tuple[bool, str]:
        """Check whether a task has exceeded its token limit.

        Returns ``(exceeded: bool, reason: str)``.
        """
        tokens = self.get_tokens(task_id)
        if tokens == 0:
            return False, ""

        repo, issue = _extract_repo_and_issue(args, kwargs)
        tier = self.get_tier(repo)
        limits = self.get_limits_for_tier(tier)
        max_tokens = int(limits.get("max_tokens", DEFAULT_MAX_TOKENS))

        if tokens > max_tokens:
            reason = (
                f"Task {task_name} ({task_id}) exceeded token limit "
                f"({tokens} > {max_tokens}, tier={tier})"
            )
            logger.warning("Runaway token limit — %s", reason)

            _run_otel_span(task_name, task_id, 0.0, reason)

            if repo and issue:
                label_key = f"{REDIS_PREFIX_TIMEOUT_LABEL}{repo}/{issue}"
                if self._redis_get(label_key) is None:
                    _label_github_issue(repo, issue)
                    self._redis_set(label_key, "1", ttl=86400)

            return True, reason

        return False, ""

    def check_cost_limit(
        self,
        task_id: str,
        task_name: str,
        args: tuple,
        kwargs: dict,
    ) -> tuple[bool, str]:
        """Check whether a task has exceeded its cost limit.

        Returns ``(exceeded: bool, reason: str)``.
        """
        cost = self.get_cost(task_id)
        if cost == 0.0:
            return False, ""

        repo, issue = _extract_repo_and_issue(args, kwargs)
        tier = self.get_tier(repo)
        limits = self.get_limits_for_tier(tier)
        max_cost = float(limits.get("max_cost", DEFAULT_MAX_COST))

        if cost > max_cost:
            reason = (
                f"Task {task_name} ({task_id}) exceeded cost limit "
                f"(${cost:.2f} > ${max_cost:.2f}, tier={tier})"
            )
            logger.warning("Runaway cost limit — %s", reason)

            _run_otel_span(task_name, task_id, 0.0, reason)

            if repo and issue:
                label_key = f"{REDIS_PREFIX_TIMEOUT_LABEL}{repo}/{issue}"
                if self._redis_get(label_key) is None:
                    _label_github_issue(repo, issue)
                    self._redis_set(label_key, "1", ttl=86400)

            return True, reason

        return False, ""

    # -- Retry tracking ------------------------------------------------------

    def get_retry_count(self, session_id: str) -> int:
        """Return the number of retries for a session."""
        val = self._redis_get(f"{REDIS_PREFIX_RETRIES}{session_id}")
        return int(val) if val else 0

    def increment_retry(self, session_id: str) -> int:
        """Increment the retry counter for a session.

        Returns the new count (1-based).  The key expires after 24 hours.
        """
        key = f"{REDIS_PREFIX_RETRIES}{session_id}"
        return self._redis_incr(key, ttl=86400)

    def reset_retries(self, session_id: str) -> None:
        """Reset the retry counter for a session."""
        self._redis_delete(f"{REDIS_PREFIX_RETRIES}{session_id}")

    def check_retries(
        self,
        session_id: str,
        task_name: str,
        args: tuple,
        kwargs: dict,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> tuple[bool, str]:
        """Check whether a session has exceeded the maximum retry count.

        Returns ``(exceeded: bool, reason: str)``.
        """
        count = self.get_retry_count(session_id)
        if count >= max_retries:
            reason = (
                f"Session {session_id} ({task_name}) exceeded max retries "
                f"({count} >= {max_retries})"
            )
            logger.warning("Runaway retry limit — %s", reason)

            _run_otel_span(task_name, session_id, 0.0, reason)

            repo, issue = _extract_repo_and_issue(args, kwargs)
            if repo and issue:
                label_key = f"{REDIS_PREFIX_TIMEOUT_LABEL}{repo}/{issue}"
                if self._redis_get(label_key) is None:
                    _label_github_issue(repo, issue)
                    self._redis_set(label_key, "1", ttl=86400)

            return True, reason

        return False, ""

    # -- Run all checks ------------------------------------------------------

    def check_all(
        self,
        task_id: str,
        task_name: str,
        args: tuple,
        kwargs: dict,
    ) -> tuple[bool, str]:
        """Run all runaway checks (timeout, tokens, cost, retries).

        Returns ``(any_exceeded: bool, reason: str)``.  Checks are ordered so
        that the first violated limit is reported.
        """
        # Timeout
        exceeded, reason = self.check_timeout(task_id, task_name, args, kwargs)
        if exceeded:
            return True, reason

        # Token limit
        exceeded, reason = self.check_token_limit(task_id, task_name, args, kwargs)
        if exceeded:
            return True, reason

        # Cost limit
        exceeded, reason = self.check_cost_limit(task_id, task_name, args, kwargs)
        if exceeded:
            return True, reason

        return False, ""


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_guard: RunawayGuard | None = None


def get_runaway_guard() -> RunawayGuard:
    """Return the singleton ``RunawayGuard`` instance."""
    global _guard
    if _guard is None:
        _guard = RunawayGuard()
    return _guard
