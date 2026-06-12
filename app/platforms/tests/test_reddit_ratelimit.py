"""Tests for app.platforms.reddit_ratelimit."""

from __future__ import annotations

import time
from unittest.mock import Mock, patch

import pytest

from app.platforms.reddit_ratelimit import (
    DEFAULT_BASE_DELAY,
    DEFAULT_JITTER_FACTOR,
    DEFAULT_MAX_DELAY,
    DEFAULT_MAX_RETRIES,
    DEFAULT_USER_AGENTS,
    BackoffState,
    RedditProxyPool,
    RedditRateLimiter,
    Proxy,
    _RetryAttempts,
    _RetryContext,
    call_with_backoff,
    handle_http_error,
    is_rate_limit_error,
    reddit_proxy_pool,
    reddit_rate_limiter,
    rotate_user_agent,
)

# ======================================================================
# Exponential backoff calculation
# ======================================================================


class TestRedditRateLimiter:
    """Tests for ``RedditRateLimiter`` backoff calculation."""

    def test_default_config(self):
        limiter = RedditRateLimiter()
        assert limiter.max_retries == DEFAULT_MAX_RETRIES
        assert limiter.base_delay == DEFAULT_BASE_DELAY
        assert limiter.max_delay == DEFAULT_MAX_DELAY
        assert limiter.jitter_factor == DEFAULT_JITTER_FACTOR

    def test_compute_delay_no_jitter(self):
        """With jitter_factor=0, delays should be deterministic."""
        limiter = RedditRateLimiter(jitter_factor=0.0)
        assert limiter.compute_delay(0) == 2.0
        assert limiter.compute_delay(1) == 4.0
        assert limiter.compute_delay(2) == 8.0
        assert limiter.compute_delay(3) == 16.0
        assert limiter.compute_delay(4) == 32.0

    def test_compute_delay_caps_at_max(self):
        """Delay should not exceed max_delay."""
        limiter = RedditRateLimiter(base_delay=10, max_delay=100, jitter_factor=0.0)
        # 10 * 2^3 = 80, still under 100
        assert limiter.compute_delay(3) == 80.0
        # 10 * 2^4 = 160, capped at 100
        assert limiter.compute_delay(4) == 100.0
        # 10 * 2^10 = 10240, capped at 100
        assert limiter.compute_delay(10) == 100.0

    def test_compute_delay_with_jitter(self):
        """With jitter, delay should be within expected range."""
        limiter = RedditRateLimiter(jitter_factor=0.1)
        for attempt in range(5):
            delay = limiter.compute_delay(attempt)
            base = min(DEFAULT_BASE_DELAY * (2 ** attempt), DEFAULT_MAX_DELAY)
            assert base * 0.9 <= delay <= base * 1.1, (
                f"Attempt {attempt}: delay {delay} outside ±10% of {base}"
            )

    def test_get_retry_delay_increments_attempt(self):
        limiter = RedditRateLimiter(jitter_factor=0.0)
        delay_1 = limiter.get_retry_delay("test_op")
        assert delay_1 == 2.0
        state = limiter._state["test_op"]
        assert state.attempt == 1
        assert state.last_delay == 2.0

        delay_2 = limiter.get_retry_delay("test_op")
        assert delay_2 == 4.0
        assert state.attempt == 2

    def test_reset_clears_state(self):
        limiter = RedditRateLimiter()
        limiter.get_retry_delay("op_a")
        limiter.get_retry_delay("op_b")
        assert len(limiter._state) == 2
        limiter.reset("op_a")
        assert "op_a" not in limiter._state
        assert "op_b" in limiter._state

    def test_reset_all_clears_all(self):
        limiter = RedditRateLimiter()
        limiter.get_retry_delay("op_a")
        limiter.get_retry_delay("op_b")
        limiter.reset_all()
        assert len(limiter._state) == 0

    def test_state_snapshot(self):
        limiter = RedditRateLimiter(jitter_factor=0.0)
        limiter.get_retry_delay("op_1")
        snapshot = limiter.state_snapshot
        assert "op_1" in snapshot
        assert snapshot["op_1"]["attempt"] == 1
        assert snapshot["op_1"]["last_delay"] == 2.0
        assert snapshot["op_1"]["remaining"] >= 0

    def test_sleep_if_needed_no_state(self):
        """Should not block if there is no state for the operation."""
        limiter = RedditRateLimiter()
        start = time.time()
        limiter.sleep_if_needed("nonexistent")
        assert time.time() - start < 0.1

    @patch("time.sleep")
    def test_retry_context_sleeps_on_retry(self, mock_sleep):
        limiter = RedditRateLimiter(jitter_factor=0.0)
        ctx = _RetryContext(limiter, "op", attempt=1)
        with ctx:
            pass
        # attempt > 0 so it should have slept for the delay of attempt 1
        mock_sleep.assert_called_once_with(2.0)

    @patch("time.sleep")
    def test_retry_context_no_sleep_on_first_attempt(self, mock_sleep):
        limiter = RedditRateLimiter()
        ctx = _RetryContext(limiter, "op", attempt=0)
        with ctx:
            pass
        mock_sleep.assert_not_called()

    def test_retry_context_success_resets(self):
        limiter = RedditRateLimiter()
        limiter.get_retry_delay("op")  # creates state
        assert "op" in limiter._state
        ctx = _RetryContext(limiter, "op", attempt=1)
        with ctx:
            pass
        assert "op" not in limiter._state  # reset on success

    def test_retry_context_rate_limit_suppressed(self):
        """A rate-limit exception should be suppressed (return True)."""
        limiter = RedditRateLimiter()
        ctx = _RetryContext(limiter, "op", attempt=1)
        exc = Exception("RATELIMIT: slow down")
        with ctx:
            pass
        result = ctx.__exit__(Exception, exc, None)
        assert result is True  # suppressed

    def test_retry_context_non_retryable_propagates(self):
        """A non-rate-limit exception should propagate (return False)."""
        limiter = RedditRateLimiter()
        ctx = _RetryContext(limiter, "op", attempt=1)
        with ctx:
            pass
        result = ctx.__exit__(ValueError, ValueError("bad data"), None)
        assert result is False  # not suppressed

    def test_retry_attempts_generates_correct_count(self):
        limiter = RedditRateLimiter(max_retries=3)
        attempts = list(limiter.retry_attempts("op"))
        assert len(attempts) == 3
        assert all(isinstance(a, _RetryContext) for a in attempts)
        assert [a.attempt for a in attempts] == [0, 1, 2]


# ======================================================================
# HTTP error handling
# ======================================================================


class TestHandleHttpError:
    def test_429_returns_60s(self):
        delay = handle_http_error(429, "Too Many Requests")
        assert delay == 60.0

    def test_403_banned_returns_300s(self):
        delay = handle_http_error(403, "Forbidden: your IP has been banned")
        assert delay == 300.0

    def test_403_blocked_returns_300s(self):
        delay = handle_http_error(403, "Access denied: blocked")
        assert delay == 300.0

    def test_403_not_banned_returns_none(self):
        """403 without ban keywords should not be retried (e.g. bad auth)."""
        delay = handle_http_error(403, "Forbidden: insufficient permissions")
        assert delay is None

    def test_500_returns_30s(self):
        delay = handle_http_error(500, "Internal Server Error")
        assert delay == 30.0

    def test_502_returns_30s(self):
        delay = handle_http_error(502, "Bad Gateway")
        assert delay == 30.0

    def test_503_returns_30s(self):
        delay = handle_http_error(503, "Service Unavailable")
        assert delay == 30.0

    def test_504_returns_30s(self):
        delay = handle_http_error(504, "Gateway Timeout")
        assert delay == 30.0

    def test_other_status_returns_none(self):
        delay = handle_http_error(401, "Unauthorized")
        assert delay is None
        delay = handle_http_error(404, "Not Found")
        assert delay is None


# ======================================================================
# Rate-limit error detection
# ======================================================================


class TestIsRateLimitError:
    def test_detects_ratelimit_keywords(self):
        assert is_rate_limit_error(Exception("RATELIMIT: slow down")) is True
        assert is_rate_limit_error(Exception("Too many requests")) is True
        assert is_rate_limit_error(Exception("try again later")) is True
        assert is_rate_limit_error(Exception("your request has been blocked")) is True

    def test_detects_forbidden_keywords(self):
        assert is_rate_limit_error(Exception("Forbidden")) is True
        assert is_rate_limit_error(Exception("banned")) is True

    def test_ignores_other_exceptions(self):
        assert is_rate_limit_error(Exception("Some other error")) is False
        assert is_rate_limit_error(ValueError("bad value")) is False

    def test_detects_status_code_attribute(self):
        exc = Exception("Something went wrong")
        exc.status_code = 429  # type: ignore[attr-defined]
        assert is_rate_limit_error(exc) is True
        exc.status_code = 403  # type: ignore[attr-defined]
        assert is_rate_limit_error(exc) is True
        exc.status_code = 500  # type: ignore[attr-defined]
        assert is_rate_limit_error(exc) is False

    def test_detects_response_status_code(self):
        mock_response = Mock()
        mock_response.status_code = 429
        exc = Exception("error")
        exc.response = mock_response  # type: ignore[attr-defined]
        assert is_rate_limit_error(exc) is True


# ======================================================================
# User-agent rotation
# ======================================================================


class TestRotateUserAgent:
    def test_returns_string_from_pool(self):
        ua = rotate_user_agent()
        assert isinstance(ua, str)
        assert len(ua) > 20

    def test_uses_default_pool(self):
        ua = rotate_user_agent()
        assert ua in DEFAULT_USER_AGENTS

    def test_uses_custom_pool(self):
        custom = ["CustomAgent/1.0"]
        ua = rotate_user_agent(custom)
        assert ua == "CustomAgent/1.0"

    def test_randomness(self):
        """Multiple calls should produce different agents (probabilistic)."""
        agents = {rotate_user_agent() for _ in range(50)}
        # With 10 agents in the pool, 50 picks should yield at least 5 unique strings
        assert len(agents) >= 5


# ======================================================================
# Proxy pool management
# ======================================================================


class TestRedditProxyPool:
    def test_empty_pool(self):
        pool = RedditProxyPool()
        assert pool.has_proxies is False
        assert pool.alive_count == 0
        assert pool.get_next_proxy() is None

    def test_add_proxy(self):
        pool = RedditProxyPool()
        pool.add_proxy("socks5://proxy1:1080")
        assert pool.has_proxies is True
        assert pool.alive_count == 1

    def test_get_next_proxy_round_robin(self):
        pool = RedditProxyPool(
            proxies=["http://p1", "http://p2", "http://p3"],
            max_failures=5,
        )
        seen = {pool.get_next_proxy() for _ in range(6)}
        assert seen == {"http://p1", "http://p2", "http://p3"}

    def test_mark_failure_then_dead(self):
        pool = RedditProxyPool(
            proxies=["http://p1", "http://p2"],
            max_failures=2,
        )
        p1_url = pool.get_next_proxy()
        assert p1_url == "http://p1"

        pool.mark_failure("http://p1")  # 1 failure -- still alive
        assert pool.alive_count == 2
        assert any(p.is_alive for p in pool._proxies if p.url == "http://p1")

        pool.mark_failure("http://p1")  # 2 failures -- dead
        assert pool.alive_count == 1
        assert not any(p.is_alive for p in pool._proxies if p.url == "http://p1")

    def test_mark_success_resets_failures(self):
        pool = RedditProxyPool(
            proxies=["http://p1"],
            max_failures=1,
        )
        pool.get_next_proxy()
        pool.mark_failure("http://p1")  # would be dead
        pool.mark_success("http://p1")  # but we reset
        assert pool.alive_count == 1
        p = [p for p in pool._proxies if p.url == "http://p1"][0]
        assert p.failure_count == 0

    def test_remove_proxy(self):
        pool = RedditProxyPool(proxies=["http://p1", "http://p2"])
        pool.remove_proxy("http://p1")
        assert pool.has_proxies is True
        assert pool.alive_count == 1
        assert pool.get_next_proxy() == "http://p2"

    def test_dead_proxy_revives_after_cooldown(self):
        pool = RedditProxyPool(
            proxies=["http://p1"],
            max_failures=1,
            cooldown_seconds=0.01,  # very short cooldown
        )
        pool.get_next_proxy()
        pool.mark_failure("http://p1")
        assert pool.alive_count == 0

        time.sleep(0.02)  # wait for cooldown
        url = pool.get_next_proxy()
        assert url == "http://p1"
        assert pool.alive_count == 1

    def test_list_proxies(self):
        pool = RedditProxyPool(proxies=["http://p1", "http://p2"])
        snapshot = pool.list_proxies()
        assert len(snapshot) == 2
        assert snapshot[0]["url"] == "http://p1"
        assert snapshot[0]["is_alive"] is True


# ======================================================================
# call_with_backoff convenience wrapper
# ======================================================================


class TestCallWithBackoff:
    def test_successful_call_returns_result(self):
        def my_func(a, b=None):
            return a + (b or 0)

        result = call_with_backoff(my_func, 1, b=2)
        assert result == 3

    def test_rate_limit_retries_then_raises(self):
        """Should exhaust retries and raise on persistent rate-limit error."""
        limiter = RedditRateLimiter(max_retries=2, base_delay=0.01, max_delay=0.1, jitter_factor=0.0)

        call_count = 0

        def failing_func():
            nonlocal call_count
            call_count += 1
            raise Exception("RATELIMIT: try again later")

        with pytest.raises(Exception, match="RATELIMIT"):
            call_with_backoff(failing_func, limiter=limiter, operation_id="test")

        assert call_count == 2  # initial + 1 retry

    def test_non_retryable_exception_propagates_immediately(self):
        """Non-rate-limit errors should not be retried."""
        limiter = RedditRateLimiter(max_retries=3, base_delay=0.01)

        call_count = 0

        def failing_func():
            nonlocal call_count
            call_count += 1
            raise ValueError("not a rate limit error")

        with pytest.raises(ValueError):
            call_with_backoff(failing_func, limiter=limiter, operation_id="test")

        assert call_count == 1  # no retries

    def test_succeeds_on_retry(self):
        """Should succeed when the function works on a later attempt."""
        limiter = RedditRateLimiter(max_retries=3, base_delay=0.01, max_delay=0.05, jitter_factor=0.0)

        call_count = 0

        def flaky_func():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise Exception("RATELIMIT")
            return "success"

        result = call_with_backoff(flaky_func, limiter=limiter, operation_id="flaky")
        assert result == "success"
        assert call_count == 2

    def test_uses_default_limiter(self):
        """When no limiter is provided, a default one should be used."""
        result = call_with_backoff(lambda: 42)
        assert result == 42


# ======================================================================
# Global instances
# ======================================================================


class TestGlobalInstances:
    def test_reddit_rate_limiter_is_instance(self):
        assert isinstance(reddit_rate_limiter, RedditRateLimiter)

    def test_reddit_proxy_pool_is_instance(self):
        assert isinstance(reddit_proxy_pool, RedditProxyPool)
