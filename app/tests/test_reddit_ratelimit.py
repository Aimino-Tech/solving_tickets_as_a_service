"""Tests for the Reddit rate limiting and IP ban handling module.

Tests cover:
    - Backoff computation (exponential + jitter)
    - Rate limit header parsing
    - HTTP error classification
    - Proxy pool management
    - User-agent rotation
    - Ban alert callbacks
    - Retry context manager behavior
    - call_with_backoff wrapper
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from app.platforms.reddit_ratelimit import (
    DEFAULT_BASE_DELAY,
    DEFAULT_MAX_DELAY,
    DEFAULT_MAX_RETRIES,
    DEFAULT_USER_AGENTS,
    Proxy,
    RatelimitHeaders,
    RedditBanAlert,
    RedditProxyPool,
    RedditRateLimiter,
    BackoffState,
    call_with_backoff,
    get_retry_after_from_headers,
    handle_http_error,
    init_proxy_pool_from_env,
    is_rate_limit_error,
    parse_ratelimit_headers,
    rotate_user_agent,
)


# ==============================================================================
# Backoff computation
# ==============================================================================


class TestBackoffComputation:
    def test_compute_delay_starts_at_base(self):
        limiter = RedditRateLimiter(base_delay=2.0, max_delay=300.0, jitter_factor=0)
        delay = limiter.compute_delay(0)
        assert delay == pytest.approx(2.0, abs=0.01)

    def test_compute_delay_doubles_exponentially(self):
        limiter = RedditRateLimiter(base_delay=2.0, max_delay=300.0, jitter_factor=0)
        d0 = limiter.compute_delay(0)
        d1 = limiter.compute_delay(1)
        d2 = limiter.compute_delay(2)
        assert d1 == pytest.approx(d0 * 2, abs=0.01)
        assert d2 == pytest.approx(d1 * 2, abs=0.01)

    def test_compute_delay_caps_at_max(self):
        limiter = RedditRateLimiter(base_delay=2.0, max_delay=10.0, jitter_factor=0)
        delay = limiter.compute_delay(10)
        assert delay <= 10.0

    def test_compute_delay_applies_jitter(self):
        limiter = RedditRateLimiter(base_delay=10.0, max_delay=300.0, jitter_factor=0.5)
        delays = [limiter.compute_delay(0) for _ in range(100)]
        min_d, max_d = min(delays), max(delays)
        assert min_d < max_d  # jitter creates variation
        assert min_d >= 5.0   # jitter = ±50% of 10 = 5..15
        assert max_d <= 15.0

    def test_get_retry_delay_increments_attempt(self):
        limiter = RedditRateLimiter(base_delay=2.0, max_delay=300.0, jitter_factor=0)
        d1 = limiter.get_retry_delay("test_op")
        assert limiter._state["test_op"].attempt == 1
        d2 = limiter.get_retry_delay("test_op")
        assert limiter._state["test_op"].attempt == 2
        assert d2 > d1

    def test_reset_clears_state(self):
        limiter = RedditRateLimiter()
        limiter.get_retry_delay("op1")
        limiter.get_retry_delay("op2")
        assert len(limiter._state) == 2
        limiter.reset("op1")
        assert "op1" not in limiter._state
        assert "op2" in limiter._state

    def test_reset_all_clears_all(self):
        limiter = RedditRateLimiter()
        limiter.get_retry_delay("op1")
        limiter.get_retry_delay("op2")
        limiter.reset_all()
        assert len(limiter._state) == 0

    def test_state_snapshot_returns_correct_structure(self):
        limiter = RedditRateLimiter()
        limiter.get_retry_delay("op1")
        snapshot = limiter.state_snapshot
        assert "op1" in snapshot
        assert "attempt" in snapshot["op1"]
        assert "last_delay" in snapshot["op1"]
        assert "next_retry_at" in snapshot["op1"]
        assert "remaining" in snapshot["op1"]
        assert snapshot["op1"]["attempt"] == 1

    def test_sleep_if_needed_no_state(self):
        limiter = RedditRateLimiter()
        start = time.time()
        limiter.sleep_if_needed("nonexistent")
        elapsed = time.time() - start
        assert elapsed < 0.1  # should return immediately


# ==============================================================================
# Rate limit header parsing
# ==============================================================================


class TestRateLimitHeaders:
    def test_parse_ratelimit_headers_all_present(self):
        result = parse_ratelimit_headers({
            "x-ratelimit-used": "5",
            "x-ratelimit-remaining": "55",
            "x-ratelimit-reset": "532",
        })
        assert result.used == 5.0
        assert result.remaining == 55.0
        assert result.reset == 532.0

    def test_parse_ratelimit_headers_case_insensitive(self):
        result = parse_ratelimit_headers({
            "X-RateLimit-Used": "3",
            "X-RateLimit-Remaining": "57",
            "X-RateLimit-Reset": "120",
        })
        assert result.used == 3.0
        assert result.remaining == 57.0
        assert result.reset == 120.0

    def test_parse_ratelimit_headers_missing_defaults(self):
        result = parse_ratelimit_headers({})
        assert result.used == 0.0
        assert result.remaining == 60.0
        assert result.reset == 60.0

    def test_parse_ratelimit_headers_none(self):
        result = parse_ratelimit_headers(None)
        assert result.used == 0.0
        assert result.remaining == 60.0
        assert result.reset == 60.0

    def test_parse_ratelimit_headers_partial(self):
        result = parse_ratelimit_headers({"x-ratelimit-used": "2"})
        assert result.used == 2.0
        assert result.remaining == 60.0  # default
        assert result.reset == 60.0      # default

    def test_parse_ratelimit_headers_invalid_values(self):
        result = parse_ratelimit_headers({
            "x-ratelimit-used": "abc",
            "x-ratelimit-remaining": "",
            "x-ratelimit-reset": "null",
        })
        assert result.used == 0.0
        assert result.remaining == 60.0
        assert result.reset == 60.0

    def test_get_retry_after_from_retry_after_header(self):
        delay = get_retry_after_from_headers({"Retry-After": "120"}, status_code=429)
        assert delay == 120.0

    def test_get_retry_after_from_x_ratelimit(self):
        delay = get_retry_after_from_headers({"x-ratelimit-reset": "45"}, status_code=429)
        assert delay == 45.0

    def test_get_retry_after_defaults(self):
        assert get_retry_after_from_headers(None, status_code=429) == 60.0
        assert get_retry_after_from_headers(None, status_code=403) == 300.0
        assert get_retry_after_from_headers(None, status_code=500) == 30.0
        assert get_retry_after_from_headers(None, status_code=418) == 60.0


# ==============================================================================
# HTTP error handling
# ==============================================================================


class TestHttpErrorHandling:
    def test_handle_429_returns_delay(self):
        delay = handle_http_error(429, "too many requests")
        assert delay is not None
        assert delay > 0

    def test_handle_403_ban_returns_delay(self):
        delay = handle_http_error(403, "banned")
        assert delay is not None
        assert delay > 0

    def test_handle_403_blocked_returns_delay(self):
        delay = handle_http_error(403, "your request has been blocked")
        assert delay is not None
        assert delay > 0

    def test_handle_403_not_retryable(self):
        delay = handle_http_error(403, "invalid OAuth token")
        assert delay is None

    def test_handle_500_returns_delay(self):
        delay = handle_http_error(500, "internal server error")
        assert delay is not None
        assert delay > 0

    def test_handle_502_returns_delay(self):
        delay = handle_http_error(502, "bad gateway")
        assert delay is not None

    def test_handle_404_not_retryable(self):
        delay = handle_http_error(404, "not found")
        assert delay is None

    def test_handle_401_not_retryable(self):
        delay = handle_http_error(401, "unauthorized")
        assert delay is None

    def test_handle_http_error_fires_ban_alert_on_403_ban(self):
        alerts = []
        from app.platforms.reddit_ratelimit import reddit_ban_alert
        def capture(msg):
            alerts.append(msg)
        reddit_ban_alert.register(capture)
        try:
            handle_http_error(403, "banned for spamming")
            assert len(alerts) == 1
            assert "IP ban" in alerts[0]
        finally:
            reddit_ban_alert.unregister(capture)


# ==============================================================================
# Rate limit error detection
# ==============================================================================


class TestIsRateLimitError:
    def test_keyword_detection(self):
        assert is_rate_limit_error(Exception("RATELIMIT"))
        assert is_rate_limit_error(Exception("too many requests"))
        assert is_rate_limit_error(Exception("try again later"))
        assert is_rate_limit_error(Exception("banned"))
        assert is_rate_limit_error(Exception("access denied"))

    def test_status_code_on_exception(self):
        exc = Exception("some error")
        exc.status_code = 429
        assert is_rate_limit_error(exc)

        exc2 = Exception("some error")
        exc2.status_code = 403
        assert is_rate_limit_error(exc2)

    def test_status_code_on_response(self):
        exc = Exception("some error")
        resp = MagicMock()
        resp.status_code = 429
        exc.response = resp
        assert is_rate_limit_error(exc)

    def test_non_rate_limit_error(self):
        assert not is_rate_limit_error(Exception("everything is fine"))
        assert not is_rate_limit_error(Exception("200 OK"))

        exc = Exception("not found")
        exc.status_code = 404
        assert not is_rate_limit_error(exc)


# ==============================================================================
# User-Agent rotation
# ==============================================================================


class TestUserAgentRotation:
    def test_rotate_returns_string(self):
        ua = rotate_user_agent()
        assert isinstance(ua, str)
        assert len(ua) > 20

    def test_rotate_from_default_pool(self):
        ua = rotate_user_agent()
        assert ua in DEFAULT_USER_AGENTS

    def test_rotate_from_custom_pool(self):
        pool = ["custom-ua/1.0"]
        ua = rotate_user_agent(pool)
        assert ua == "custom-ua/1.0"

    def test_rotate_randomness(self):
        results = {rotate_user_agent() for _ in range(100)}
        # With 10 agents, 100 picks should yield at least 3 different ones
        assert len(results) >= 3


# ==============================================================================
# Proxy pool
# ==============================================================================


class TestProxyPool:
    def test_empty_pool(self):
        pool = RedditProxyPool()
        assert not pool.has_proxies
        assert pool.alive_count == 0
        assert pool.get_next_proxy() is None

    def test_add_and_retrieve_proxy(self):
        pool = RedditProxyPool()
        pool.add_proxy("socks5://1.2.3.4:1080")
        assert pool.has_proxies
        assert pool.alive_count == 1
        assert pool.get_next_proxy() == "socks5://1.2.3.4:1080"

    def test_multiple_proxies_rotate(self):
        pool = RedditProxyPool(proxies=["p1", "p2", "p3"])
        seen = set()
        for _ in range(6):
            seen.add(pool.get_next_proxy())
        assert seen == {"p1", "p2", "p3"}

    def test_mark_failure_then_dead(self):
        pool = RedditProxyPool(proxies=["p1"], max_failures=2)
        pool.mark_failure("p1")
        assert pool.alive_count == 1
        pool.mark_failure("p1")
        assert pool.alive_count == 0
        assert pool.get_next_proxy() is None

    def test_mark_success_resets_failures(self):
        pool = RedditProxyPool(proxies=["p1"], max_failures=3)
        pool.mark_failure("p1")
        pool.mark_failure("p1")
        pool.mark_success("p1")
        proxy = pool._proxies[0]
        assert proxy.failure_count == 0
        assert proxy.is_alive is True

    def test_remove_proxy(self):
        pool = RedditProxyPool(proxies=["p1", "p2"])
        pool.remove_proxy("p1")
        assert len(pool._proxies) == 1
        assert pool._proxies[0].url == "p2"

    def test_list_proxies(self):
        pool = RedditProxyPool(proxies=["p1", "p2"])
        info = pool.list_proxies()
        assert len(info) == 2
        assert info[0]["url"] == "p1"
        assert info[0]["is_alive"] is True

    def test_dead_proxy_cooldown_revive(self):
        pool = RedditProxyPool(proxies=["p1"], max_failures=1, cooldown_seconds=0.01)
        pool.mark_failure("p1")
        assert pool.alive_count == 0
        time.sleep(0.02)
        revived = pool.get_next_proxy()
        assert revived == "p1"
        assert pool.alive_count == 1


# ==============================================================================
# Ban alert callbacks
# ==============================================================================


class TestBanAlert:
    def test_register_and_fire(self):
        alert = RedditBanAlert()
        received = []
        alert.register(lambda msg: received.append(msg))
        alert.fire("test ban", status_code=403)
        assert len(received) == 1
        assert "test ban" in received[0]

    def test_multiple_callbacks(self):
        alert = RedditBanAlert()
        c1, c2 = [], []
        alert.register(c1.append)
        alert.register(c2.append)
        alert.fire("alert!")
        assert len(c1) == 1
        assert len(c2) == 1

    def test_unregister(self):
        alert = RedditBanAlert()
        received = []
        cb = received.append
        alert.register(cb)
        alert.unregister(cb)
        alert.fire("should not fire")
        assert len(received) == 0

    def test_callback_exception_does_not_propagate(self):
        alert = RedditBanAlert()

        def failing(_msg):
            raise ValueError("oops")

        alert.register(failing)
        # This should not raise
        alert.fire("test")

    def test_callback_count(self):
        alert = RedditBanAlert()
        assert alert.callback_count == 0
        alert.register(lambda m: None)
        assert alert.callback_count == 1
        alert.register(lambda m: None)
        assert alert.callback_count == 2


# ==============================================================================
# init_proxy_pool_from_env
# ==============================================================================


class TestInitProxyPoolFromEnv:
    @patch.dict("os.environ", {"REDDIT_PROXY_URLS": "socks5://p1:1080,http://p2:3128"})
    def test_loads_from_env(self):
        pool = init_proxy_pool_from_env()
        assert pool.has_proxies
        assert pool.alive_count == 2

    @patch.dict("os.environ", {}, clear=True)
    def test_empty_env(self):
        pool = init_proxy_pool_from_env()
        assert not pool.has_proxies

    @patch.dict("os.environ", {"REDDIT_PROXY_MAX_FAILURES": "5", "REDDIT_PROXY_COOLDOWN": "600"})
    def test_overrides_config(self):
        pool = init_proxy_pool_from_env()
        assert pool._max_failures == 5
        assert pool._cooldown_seconds == 600.0

    @patch.dict("os.environ", {"REDDIT_PROXY_URLS": "p1"})
    def test_populates_existing_pool(self):
        existing = RedditProxyPool(proxies=["existing"])
        pool = init_proxy_pool_from_env(pool=existing)
        assert len(pool._proxies) == 2


# ==============================================================================
# Retry context manager
# ==============================================================================


class TestRetryContext:
    def test_success_resets_backoff(self):
        limiter = RedditRateLimiter(base_delay=1.0, max_delay=5.0, jitter_factor=0)
        for attempt in limiter.retry_attempts("test"):
            with attempt:
                pass  # success
        assert "test" not in limiter._state  # reset on success

    def test_rate_limit_retries_and_suppresses(self):
        limiter = RedditRateLimiter(max_retries=2, base_delay=0.01, max_delay=0.1, jitter_factor=0)
        call_count = 0

        for attempt in limiter.retry_attempts("test"):
            with attempt:
                call_count += 1
                exc = Exception("RATELIMIT: slow down")
                exc.status_code = 429
                raise exc

        # Should have retried max_retries times
        assert call_count == 2

    def test_non_retryable_exception_propagates(self):
        limiter = RedditRateLimiter(max_retries=3, base_delay=0.01, max_delay=0.1, jitter_factor=0)
        call_count = 0

        with pytest.raises(ValueError, match="bad data"):
            for attempt in limiter.retry_attempts("test"):
                with attempt:
                    call_count += 1
                    raise ValueError("bad data")

        assert call_count == 1  # only called once

    def test_last_exception_raised_when_retries_exhausted(self):
        limiter = RedditRateLimiter(max_retries=2, base_delay=0.01, max_delay=0.1, jitter_factor=0)

        last_exc = None
        for attempt in limiter.retry_attempts("test"):
            with attempt:
                exc = Exception("RATELIMIT: exhausted")
                exc.status_code = 429
                last_exc = exc
                raise exc

        # The context manager suppresses the exception by design.
        # After all retries are exhausted, the last exception remains captured.
        assert last_exc is not None
        assert "RATELIMIT" in str(last_exc)
        # get_retry_delay is only called on retries (attempt > 0), so attempt=1 here
        assert limiter._state["test"].attempt == 1


# ==============================================================================
# call_with_backoff wrapper
# ==============================================================================


class TestCallWithBackoff:
    def test_success_returns_result(self):
        result = call_with_backoff(lambda: "success", operation_id="test")
        assert result == "success"

    def test_retries_on_rate_limit(self):
        call_count = [0]

        def flaky():
            call_count[0] += 1
            if call_count[0] < 2:
                exc = Exception("RATELIMIT: slow down")
                exc.status_code = 429
                raise exc
            return "ok"

        limiter = RedditRateLimiter(max_retries=3, base_delay=0.01, max_delay=0.1, jitter_factor=0)
        result = call_with_backoff(flaky, limiter=limiter, operation_id="flaky")
        assert result == "ok"
        assert call_count[0] == 2

    def test_raises_after_exhausted(self):
        call_count = [0]

        def always_fails():
            call_count[0] += 1
            exc = Exception("RATELIMIT: always")
            exc.status_code = 429
            raise exc

        limiter = RedditRateLimiter(max_retries=2, base_delay=0.01, max_delay=0.1, jitter_factor=0)
        with pytest.raises(Exception, match="RATELIMIT"):
            call_with_backoff(always_fails, limiter=limiter, operation_id="bad")
        assert call_count[0] == 2

    def test_non_rate_limit_passes_through(self):
        def bad():
            raise ValueError("not a rate limit")

        with pytest.raises(ValueError, match="not a rate limit"):
            call_with_backoff(bad, operation_id="bad")

    def test_creates_default_limiter(self):
        result = call_with_backoff(lambda: "ok", operation_id="default_test")
        assert result == "ok"


# ==============================================================================
# Global instances
# ==============================================================================


class TestGlobalInstances:
    def test_reddit_rate_limiter_is_singleton(self):
        from app.platforms.reddit_ratelimit import reddit_rate_limiter as r1
        from app.platforms.reddit_ratelimit import reddit_rate_limiter as r2
        assert r1 is r2

    def test_reddit_proxy_pool_is_singleton(self):
        from app.platforms.reddit_ratelimit import reddit_proxy_pool as p1
        from app.platforms.reddit_ratelimit import reddit_proxy_pool as p2
        assert p1 is p2

    def test_reddit_ban_alert_is_singleton(self):
        from app.platforms.reddit_ratelimit import reddit_ban_alert as a1
        from app.platforms.reddit_ratelimit import reddit_ban_alert as a2
        assert a1 is a2
