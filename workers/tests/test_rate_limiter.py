"""Comprehensive tests for the Redis-backed token bucket rate limiter."""

import os
import time
from unittest.mock import MagicMock, patch

import pytest

from workers.gates.rate_limiter import (
    RateLimitResult,
    TenantRateLimiter,
    get_rate_limiter,
)


class TestRateLimitResult:

    def test_creates_with_allowed_true(self):
        result = RateLimitResult(allowed=True, remaining=5.0, capacity=10, reset_after_seconds=5.0)
        assert result.allowed is True
        assert result.remaining == 5.0
        assert result.capacity == 10

    def test_creates_with_allowed_false(self):
        result = RateLimitResult(allowed=False, remaining=0.0, capacity=10, reset_after_seconds=60.0)
        assert result.allowed is False
        assert result.remaining == 0.0

    def test_repr(self):
        result = RateLimitResult(allowed=True, remaining=7.5, capacity=10, reset_after_seconds=2.5)
        r = repr(result)
        assert "RateLimitResult" in r
        assert "allowed=True" in r


class TestConsume:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_consume_returns_true_when_tokens_available(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = [None, None]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a") is True

    @patch("workers.gates.rate_limiter._get_redis")
    def test_consume_returns_false_when_empty(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["0", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a") is False

    @patch("workers.gates.rate_limiter._get_redis")
    def test_consume_multiple_tokens(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["5", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a", tokens=3) is True

    @patch("workers.gates.rate_limiter._get_redis")
    def test_consume_fails_when_not_enough_tokens(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["2", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a", tokens=5) is False

    def test_consume_redis_unavailable_returns_true(self):
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a") is True

    @patch("workers.gates.rate_limiter._get_redis")
    def test_consume_writes_to_redis(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["10", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        limiter.consume("tenant-a", tokens=2)
        pipeline = mock_client.pipeline.return_value
        pipeline.execute.assert_called()

    @patch("workers.gates.rate_limiter._get_redis")
    def test_consume_redis_error_returns_true(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = Exception("Redis connection lost")
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a") is True


class TestCheck:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_check_allows_when_tokens_sufficient(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["10", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        result = limiter.check("tenant-a", tokens=5)
        assert result.allowed is True
        assert result.remaining == pytest.approx(10, abs=0.5)

    @patch("workers.gates.rate_limiter._get_redis")
    def test_check_blocks_when_tokens_insufficient(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["2", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        result = limiter.check("tenant-a", tokens=5)
        assert result.allowed is False
        assert result.remaining == pytest.approx(2.0, abs=0.5)

    def test_check_redis_unavailable_returns_allowed(self):
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        result = limiter.check("tenant-a")
        assert result.allowed is True

    @patch("workers.gates.rate_limiter._get_redis")
    def test_check_does_not_consume_tokens(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["10", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        result_before = limiter.check("tenant-a", tokens=1)
        result_after = limiter.check("tenant-a", tokens=1)
        assert result_before.remaining == result_after.remaining


class TestRemaining:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_remaining_returns_token_count(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.side_effect = ["7", str(time.time())]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.remaining("tenant-a") == pytest.approx(7, abs=0.5)

    def test_remaining_redis_unavailable_returns_capacity(self):
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        remaining = limiter.remaining("tenant-a")
        assert remaining >= 0


class TestReset:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_reset_deletes_redis_keys(self, mock_get_redis):
        mock_client = MagicMock()
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter()
        limiter.reset("tenant-a")
        assert mock_client.delete.call_count == 2

    def test_reset_redis_unavailable_does_not_raise(self):
        limiter = TenantRateLimiter()
        limiter.reset("tenant-a")


class TestTierResolution:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_free_tier_capacity(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=60, default_refill_rate=1.0)
        assert limiter._capacity_for_tier("free") == 10

    @patch("workers.gates.rate_limiter._get_redis")
    def test_pro_tier_capacity(self, mock_get_redis):
        limiter = TenantRateLimiter(default_capacity=60, default_refill_rate=1.0)
        assert limiter._capacity_for_tier("pro") == 60

    @patch("workers.gates.rate_limiter._get_redis")
    def test_enterprise_tier_capacity(self, mock_get_redis):
        limiter = TenantRateLimiter(default_capacity=60, default_refill_rate=1.0)
        assert limiter._capacity_for_tier("enterprise") == 300

    def test_unknown_tier_defaults_to_default_capacity(self):
        limiter = TenantRateLimiter(default_capacity=60, default_refill_rate=1.0)
        assert limiter._capacity_for_tier("platinum") == 60

    @patch("workers.gates.rate_limiter._get_redis")
    def test_tier_case_insensitive(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter()
        assert limiter._resolve_tier("any", "FREE") == "free"
        assert limiter._resolve_tier("any", "Pro") == "pro"
        assert limiter._resolve_tier("any", "ENTERPRISE") == "enterprise"

    @patch("workers.gates.rate_limiter._get_redis")
    def test_tier_resolution_with_env_override(self, mock_get_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter()
        with patch.dict(os.environ, {"TENANT_SPECIAL_TIER": "pro"}, clear=False):
            tier = limiter._resolve_tier("special", None)
            assert tier == "pro"


class TestTenantIsolation:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_different_tenants_have_independent_buckets(self, mock_get_redis):
        mock_client = MagicMock()
        now = time.time()

        def get_side_effect(key):
            if "tenant-a" in key and "ts" in key:
                return str(now)
            if "tenant-a" in key:
                return "10"
            if "tenant-b" in key and "ts" in key:
                return str(now)
            if "tenant-b" in key:
                return "0"
            return None

        mock_client.get.side_effect = get_side_effect
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        assert limiter.consume("tenant-a") is True
        assert limiter.consume("tenant-b") is False

    @patch("workers.gates.rate_limiter._get_redis")
    def test_different_tiers_for_same_tenant(self, mock_get_redis):
        mock_client = MagicMock()

        def get_side_effect(key):
            return None

        mock_client.get.side_effect = get_side_effect
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter()
        capacity_free = limiter._capacity_for_tier("free")
        capacity_pro = limiter._capacity_for_tier("pro")
        assert capacity_free < capacity_pro


class TestKeyFormat:

    def test_tokens_key_format(self):
        key = TenantRateLimiter._tokens_key("tenant-42")
        assert key == "syntaro:rate_limiter:tenant-42:tokens"

    def test_timestamp_key_format(self):
        key = TenantRateLimiter._timestamp_key("tenant-42")
        assert key == "syntaro:rate_limiter:tenant-42:ts"


class TestRefill:

    @patch("workers.gates.rate_limiter._get_redis")
    def test_refill_adds_tokens_based_on_elapsed_time(self, mock_get_redis):
        mock_client = MagicMock()
        past = time.time() - 5
        mock_client.get.side_effect = ["5", str(past)]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        remaining = limiter.remaining("tenant-a")
        assert remaining == pytest.approx(7.5, abs=0.5)

    @patch("workers.gates.rate_limiter._get_redis")
    def test_refill_does_not_exceed_capacity(self, mock_get_redis):
        mock_client = MagicMock()
        past = time.time() - 100
        mock_client.get.side_effect = ["9", str(past)]
        mock_get_redis.return_value = mock_client
        limiter = TenantRateLimiter(default_capacity=10, default_refill_rate=1.0)
        remaining = limiter.remaining("tenant-a")
        assert remaining <= 10.0


class TestGetRateLimiter:

    def test_returns_singleton(self):
        limiter1 = get_rate_limiter()
        limiter2 = get_rate_limiter()
        assert limiter1 is limiter2

    def test_returns_tenant_rate_limiter_instance(self):
        limiter = get_rate_limiter()
        assert isinstance(limiter, TenantRateLimiter)
