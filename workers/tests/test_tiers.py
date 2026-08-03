"""
Comprehensive tests for free tier limits and PQL conversion (AIM-2077).

Covers:
    workers.billing.tiers       -- Tier definitions, usage counter, PQL scoring,
                                  inactivity check, periodic PQL recalculation
    workers.billing.pql         -- Nudge at fix #8, upgrade wall at fix #10,
                                  inactivity alert
    workers.billing.middleware  -- Celery pre-dispatch tier enforcement
"""

from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.billing.tiers import (
    PqlScore,
    TIER_DEFINITIONS,
    compute_pql_score,
    get_pql_score,
    get_tier_usage,
    increment_tier_usage,
    increment_tier_verified,
    is_inactive,
    recalculate_pql_scores,
    resolve_tier,
    tier_display_name,
    tier_max_fixes,
    tier_nudge_at,
    tier_wall_at,
)
from workers.billing.pql import (
    InactivityResult,
    NudgeResult,
    WallResult,
    check_inactivity,
    check_nudge,
    check_wall,
)
from workers.billing.middleware import (
    TierLimitExceeded,
    check_and_block,
    connect_tier_middleware,
    invalidate_cache,
)


# ===========================================================================
# Fixtures
# ===========================================================================


class _PipelineMock:
    """Mock pipeline that executes real hash operations."""

    def __init__(self, redis_mock: DictRedisMock) -> None:
        self._redis = redis_mock
        self._ops: list[tuple[str, tuple, dict]] = []

    def hincrby(self, key: str, field: str, amount: int = 1) -> _PipelineMock:
        self._ops.append(("hincrby", (key, field, amount), {}))
        return self

    def hset(self, key: str, field: str, value: str) -> _PipelineMock:
        self._ops.append(("hset", (key, field, value), {}))
        return self

    def expire(self, key: str, ttl: int) -> _PipelineMock:
        self._ops.append(("expire", (key, ttl), {}))
        return self

    def execute(self) -> list[Any]:
        results = []
        for op_name, args, _ in self._ops:
            op = getattr(self._redis, op_name, None)
            if op:
                result = op(*args)
                results.append(result)
            else:
                results.append(0)
        return results


class DictRedisMock:
    """In-memory Redis mock that mimics the subsets used by tiers & pql modules."""

    def __init__(self) -> None:
        self._data: dict[str, str] = {}
        self._hash_data: dict[str, dict[str, str]] = {}

    def get(self, key: str) -> str | None:
        return self._data.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self._data[key] = value

    def set(self, key: str, value: str) -> None:
        self._data[key] = value

    def delete(self, key: str) -> int:
        return 1 if self._data.pop(key, None) is not None else 0

    def ping(self) -> bool:
        return True

    def hgetall(self, key: str) -> dict[str, str]:
        return dict(self._hash_data.get(key, {}))

    def hget(self, key: str, field: str) -> str | None:
        return self._hash_data.get(key, {}).get(field)

    def hincrby(self, key: str, field: str, amount: int = 1) -> int:
        h = self._hash_data.setdefault(key, {})
        current = int(h.get(field, 0))
        new_val = current + amount
        h[field] = str(new_val)
        return new_val

    def hset(self, key: str, field: str, value: str) -> int:
        h = self._hash_data.setdefault(key, {})
        h[field] = value
        return 1

    def hsetnx(self, key: str, field: str, value: str) -> int:
        h = self._hash_data.setdefault(key, {})
        if field not in h:
            h[field] = value
            return 1
        return 0

    def expire(self, key: str, ttl: int) -> int:
        return 1

    def scan(self, cursor: int = 0, match: str | None = None, count: int = 10) -> tuple[int, list[str]]:
        if match and match.endswith("*"):
            prefix = match[:-1]
            matching = [k for k in self._hash_data if k.startswith(prefix)]
            return 0, matching
        return 0, []

    def pipeline(self) -> _PipelineMock:
        return _PipelineMock(self)

    def __getattr__(self, name: str) -> Any:
        return MagicMock()


# ===========================================================================
# Tier Definition Tests
# ===========================================================================


class TestTierDefinitions:
    def test_free_tier(self) -> None:
        assert TIER_DEFINITIONS["free"]["max_fixes"] == 10
        assert TIER_DEFINITIONS["free"]["display_name"] == "Free"
        assert TIER_DEFINITIONS["free"]["nudge_at"] == 8
        assert TIER_DEFINITIONS["free"]["wall_at"] == 10

    def test_solo_tier(self) -> None:
        assert TIER_DEFINITIONS["solo"]["max_fixes"] == 50
        assert TIER_DEFINITIONS["solo"]["display_name"] == "Solo"
        assert TIER_DEFINITIONS["solo"]["nudge_at"] is None
        assert TIER_DEFINITIONS["solo"]["wall_at"] is None

    def test_team_tier_unlimited(self) -> None:
        assert TIER_DEFINITIONS["team"]["max_fixes"] == -1
        assert TIER_DEFINITIONS["team"]["display_name"] == "Team"

    def test_enterprise_tier_unlimited(self) -> None:
        assert TIER_DEFINITIONS["enterprise"]["max_fixes"] == -1

    def test_resolve_tier_defaults_to_free(self) -> None:
        assert resolve_tier("unknown-tenant") == "free"

    def test_resolve_tier_via_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TENANT_T_CUSTOM_TIER", "solo")
        assert resolve_tier("t-custom") == "solo"

    def test_tier_max_fixes(self) -> None:
        assert tier_max_fixes("free") == 10
        assert tier_max_fixes("solo") == 50
        assert tier_max_fixes("team") == -1
        assert tier_max_fixes("enterprise") == -1

    def test_tier_display_name(self) -> None:
        assert tier_display_name("free") == "Free"
        assert tier_display_name("solo") == "Solo"
        assert tier_display_name("team") == "Team"

    def test_tier_nudge_at(self) -> None:
        assert tier_nudge_at("free") == 8
        assert tier_nudge_at("solo") is None
        assert tier_nudge_at("team") is None

    def test_tier_wall_at(self) -> None:
        assert tier_wall_at("free") == 10
        assert tier_wall_at("solo") is None
        assert tier_wall_at("team") is None


# ===========================================================================
# Tier Usage Counter Tests
# ===========================================================================


class TestTierUsageCounter:
    @patch("workers.billing.tiers._get_redis")
    def test_increment_creates_entry(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        count = increment_tier_usage("tenant-1")
        assert count == 1
        assert mc.hgetall("syntaro:tiers:tenant-1").get("usage") == "1"
        assert "last_fix_ts" in mc.hgetall("syntaro:tiers:tenant-1")

    @patch("workers.billing.tiers._get_redis")
    def test_multiple_increments_accumulate(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        count1 = increment_tier_usage("tenant-1")
        count2 = increment_tier_usage("tenant-1")
        assert count1 == 1
        assert count2 == 2

    @patch("workers.billing.tiers._get_redis")
    def test_increment_verified(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        v1 = increment_tier_verified("tenant-1")
        v2 = increment_tier_verified("tenant-1")
        assert v1 == 1
        assert v2 == 2

    @patch("workers.billing.tiers._get_redis")
    def test_get_tier_usage_defaults(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        result = get_tier_usage("new-tenant")
        assert result["tenant_id"] == "new-tenant"
        assert result["tier"] == "free"
        assert result["usage"] == 0
        assert result["verified"] == 0
        assert result["max_fixes"] == 10
        assert result["remaining"] == 10

    @patch("workers.billing.tiers._get_redis")
    def test_get_tier_usage_after_increment(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        increment_tier_usage("used-tenant")
        increment_tier_usage("used-tenant")
        increment_tier_verified("used-tenant")
        result = get_tier_usage("used-tenant")
        assert result["usage"] == 2
        assert result["verified"] == 1
        assert result["remaining"] == 8

    @patch("workers.billing.tiers._get_redis")
    def test_display_free_tier(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        increment_tier_usage("d-tenant")
        result = get_tier_usage("d-tenant")
        assert "1/10" in result["display"]
        assert "Free" in result["display"]

    @patch("workers.billing.tiers._get_redis")
    def test_display_solo_tier(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        with patch("workers.billing.tiers.resolve_tier", return_value="solo"):
            increment_tier_usage("solo-tenant")
            increment_tier_usage("solo-tenant")
            result = get_tier_usage("solo-tenant")
            assert "2/50" in result["display"]
            assert "Solo" in result["display"]

    @patch("workers.billing.tiers._get_redis")
    def test_redis_unavailable_fallback(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = None
        count = increment_tier_usage("offline")
        assert count == 0
        result = get_tier_usage("offline")
        assert result["usage"] == 0
        assert result["remaining"] == 10


# ===========================================================================
# PQL Scoring Tests
# ===========================================================================


class TestPqlScoreModel:
    def test_default_score(self) -> None:
        s = PqlScore(tenant_id="t-1")
        assert s.tenant_id == "t-1"
        assert s.score == 0.0
        assert not s.is_conversion_ready()

    def test_to_dict_roundtrip(self) -> None:
        s = PqlScore(
            tenant_id="t-1",
            score=8.5,
            fix_component=5.0,
            verified_component=2.0,
            active_days_component=1.5,
        )
        d = s.to_dict()
        assert d["is_conversion_ready"] is True
        assert d["threshold"] == 7.0
        restored = PqlScore.from_dict(d)
        assert restored.score == 8.5
        assert restored.fix_component == 5.0
        assert restored.is_conversion_ready()

    def test_from_dict_handles_missing_keys(self) -> None:
        s = PqlScore.from_dict({"tenant_id": "t-2"})
        assert s.tenant_id == "t-2"
        assert s.score == 0.0

    def test_is_conversion_ready_threshold(self) -> None:
        below = PqlScore(tenant_id="t-1", score=6.9)
        assert not below.is_conversion_ready()
        at = PqlScore(tenant_id="t-1", score=7.0)
        assert at.is_conversion_ready()
        above = PqlScore(tenant_id="t-1", score=10.0)
        assert above.is_conversion_ready()


class TestPqlScoreComputation:
    def test_minimal_usage(self) -> None:
        score = compute_pql_score(
            tenant_id="t-1",
            usage=0,
            verified=0,
            active_days=0,
            repos_connected=0,
            webhook_configured=False,
        )
        assert score.score == 0.0
        assert not score.is_conversion_ready()

    @patch("workers.billing.tiers._get_redis")
    def test_usage_only(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        score = compute_pql_score("t-1", usage=5, verified=0)
        assert score.score == 5.0
        assert score.fix_component == 5.0
        assert not score.is_conversion_ready()

    @patch("workers.billing.tiers._get_redis")
    def test_usage_and_verified(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        score = compute_pql_score("t-1", usage=5, verified=3)
        assert score.score == 11.0
        assert score.is_conversion_ready()

    @patch("workers.billing.tiers._get_redis")
    def test_full_signals(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        score = compute_pql_score(
            tenant_id="t-1",
            usage=3,
            verified=2,
            active_days=5,
            repos_connected=4,
            webhook_configured=True,
        )
        assert score.score == 16.5
        assert score.is_conversion_ready()

    @patch("workers.billing.tiers._get_redis")
    def test_repo_component_capped(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        score = compute_pql_score(
            tenant_id="t-1",
            usage=0,
            verified=0,
            active_days=0,
            repos_connected=100,
            webhook_configured=False,
        )
        assert score.repo_component == 5.0

    @patch("workers.billing.tiers._get_redis")
    def test_persists_pql_score(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        compute_pql_score("t-persist", usage=5, verified=2)
        raw = mc.get("syntaro:pql:t-persist")
        assert raw is not None
        data = json.loads(raw)
        assert data["tenant_id"] == "t-persist"
        assert data["score"] > 0

    @patch("workers.billing.tiers._get_redis")
    def test_get_pql_score_returns_existing(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.setex(
            "syntaro:pql:t-1",
            99999,
            json.dumps(PqlScore(tenant_id="t-1", score=12.5).to_dict()),
        )
        mock_get_redis.return_value = mc
        score = get_pql_score("t-1")
        assert score is not None
        assert score.score == 12.5

    @patch("workers.billing.tiers._get_redis")
    def test_get_pql_score_returns_none_for_missing(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        assert get_pql_score("missing") is None


# ===========================================================================
# Inactivity Check Tests
# ===========================================================================


class TestInactivityCheck:
    @patch("workers.billing.tiers._get_redis")
    def test_no_record_is_not_inactive(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        assert not is_inactive("new-tenant")

    @patch("workers.billing.tiers._get_redis")
    def test_recent_fix_is_not_inactive(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        now_ts = int(time.time())
        mc.hset("syntaro:tiers:active-tenant", "last_fix_ts", str(now_ts - 3600))
        mock_get_redis.return_value = mc
        assert not is_inactive("active-tenant")

    @patch("workers.billing.tiers._get_redis")
    def test_old_fix_is_inactive(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        old_ts = int(time.time()) - 15 * 24 * 60 * 60
        mc.hset("syntaro:tiers:inactive-tenant", "last_fix_ts", str(old_ts))
        mock_get_redis.return_value = mc
        assert is_inactive("inactive-tenant")

    @patch("workers.billing.tiers._get_redis")
    def test_custom_threshold(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        old_ts = int(time.time()) - 7 * 24 * 60 * 60
        mc.hset("syntaro:tiers:custom-tenant", "last_fix_ts", str(old_ts))
        mock_get_redis.return_value = mc
        assert is_inactive("custom-tenant", days=5)
        assert not is_inactive("custom-tenant", days=10)


# ===========================================================================
# PQL Nudge Tests
# ===========================================================================


class TestPqlNudge:
    @patch("workers.billing.tiers._get_redis")
    def test_no_nudge_below_threshold(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:low", "usage", "3")
        mock_get_redis.return_value = mc
        result = check_nudge("low")
        assert not result.should_nudge
        assert result.remaining == 7

    @patch("workers.billing.tiers._get_redis")
    def test_nudge_at_eight(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:nudge-tenant", "usage", "8")
        mock_get_redis.return_value = mc
        result = check_nudge("nudge-tenant")
        assert result.should_nudge
        assert result.remaining == 2
        assert result.message is not None
        assert "8 out of 10" in result.message

    @patch("workers.billing.tiers._get_redis")
    def test_no_nudge_at_wall(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:wall-tenant", "usage", "10")
        mock_get_redis.return_value = mc
        result = check_nudge("wall-tenant")
        assert not result.should_nudge

    @patch("workers.billing.tiers._get_redis")
    def test_no_nudge_for_unlimited_tier(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:unlimited", "usage", "50")
        mock_get_redis.return_value = mc
        with patch("workers.billing.tiers.resolve_tier", return_value="team"):
            result = check_nudge("unlimited")
        assert not result.should_nudge

    def test_nudge_override(self) -> None:
        result = check_nudge("override-tenant", nudge_override=1)
        assert not result.should_nudge

    @patch("workers.billing.tiers._get_redis")
    def test_nudge_at_nine(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:nine", "usage", "9")
        mock_get_redis.return_value = mc
        result = check_nudge("nine")
        assert result.should_nudge
        assert result.remaining == 1


# ===========================================================================
# Upgrade Wall Tests
# ===========================================================================


class TestUpgradeWall:
    @patch("workers.billing.tiers._get_redis")
    def test_no_wall_below_limit(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        result = check_wall("under-limit")
        assert not result.blocked

    @patch("workers.billing.tiers._get_redis")
    def test_wall_at_ten(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:at-wall", "usage", "10")
        mock_get_redis.return_value = mc
        result = check_wall("at-wall")
        assert result.blocked
        assert result.reason is not None
        assert "limit of 10 fixes" in result.reason

    @patch("workers.billing.tiers._get_redis")
    def test_wall_above_ten(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:over", "usage", "15")
        mock_get_redis.return_value = mc
        result = check_wall("over")
        assert result.blocked

    @patch("workers.billing.tiers._get_redis")
    def test_no_wall_for_unlimited_tier(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:team-tenant", "usage", "200")
        mock_get_redis.return_value = mc
        with patch("workers.billing.tiers.resolve_tier", return_value="team"):
            result = check_wall("team-tenant")
        assert not result.blocked

    def test_wall_override(self) -> None:
        result = check_wall("override-wall", wall_override=0)
        assert result.blocked
        assert result.usage == 0


# ===========================================================================
# Inactivity Alert Tests
# ===========================================================================


class TestInactivityAlert:
    @patch("workers.billing.tiers._get_redis")
    def test_no_alert_for_active(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        now_ts = int(time.time())
        mc.hset("syntaro:tiers:active", "last_fix_ts", str(now_ts - 3600))
        mc.hset("syntaro:tiers:active", "usage", "5")
        mock_get_redis.return_value = mc
        result = check_inactivity("active")
        assert not result.is_inactive

    @patch("workers.billing.tiers._get_redis")
    def test_alert_for_inactive(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        old_ts = int(time.time()) - 20 * 24 * 60 * 60
        mc.hset("syntaro:tiers:old", "last_fix_ts", str(old_ts))
        mc.hset("syntaro:tiers:old", "usage", "3")
        mock_get_redis.return_value = mc
        result = check_inactivity("old")
        assert result.is_inactive
        assert result.inactive_days is not None
        assert result.inactive_days >= 14
        assert result.alert is not None
        assert ("20 days" in result.alert or "19 days" in result.alert
                or "21 days" in result.alert)

    def test_days_override(self) -> None:
        result = check_inactivity("new-tenant", days_override=1)
        assert not result.is_inactive


# ===========================================================================
# Tier Enforcement Middleware Tests
# ===========================================================================


class TestTierMiddleware:
    def setup_method(self) -> None:
        invalidate_cache()

    def test_allows_below_limit(self) -> None:
        with patch("workers.billing.middleware.get_tier_usage") as mock_usage:
            mock_usage.return_value = {
                "tenant_id": "ok",
                "tier": "free",
                "usage": 3,
                "max_fixes": 10,
                "remaining": 7,
            }
            check_and_block("ok")

    def test_allows_unlimited_tier(self) -> None:
        invalidate_cache()
        with patch("workers.billing.middleware.resolve_tier", return_value="team"):
            check_and_block("team-tenant")

    @patch("workers.billing.middleware.get_tier_usage")
    def test_blocks_at_wall(self, mock_usage: MagicMock) -> None:
        invalidate_cache()
        mock_usage.return_value = {
            "tenant_id": "blocked",
            "tier": "free",
            "usage": 10,
            "max_fixes": 10,
            "remaining": 0,
        }
        with patch("workers.billing.middleware.resolve_tier", return_value="free"):
            with patch("workers.billing.middleware.tier_max_fixes", return_value=10):
                with patch("workers.billing.middleware.tier_wall_at", return_value=10):
                    with pytest.raises(TierLimitExceeded) as excinfo:
                        check_and_block("blocked")
        assert "blocked" in str(excinfo.value).lower() or "limit" in str(excinfo.value).lower()

    @patch("workers.billing.middleware.get_tier_usage")
    def test_fail_open_on_usage_failure(self, mock_usage: MagicMock) -> None:
        invalidate_cache()
        mock_usage.side_effect = RuntimeError("Redis down")
        check_and_block("offline")

    def test_cache_hit(self) -> None:
        invalidate_cache()
        from workers.billing.middleware import _set_cache as real_set_cache

        with patch("workers.billing.middleware._set_cache", side_effect=real_set_cache) as mock_set:
            with patch("workers.billing.middleware.resolve_tier", return_value="team"):
                check_and_block("cached-tenant")
                mock_set.assert_called_once_with("cached-tenant")
        # Second call should hit cache (resolve_tier won't be called)
        with patch("workers.billing.middleware.resolve_tier") as mock_resolve:
            check_and_block("cached-tenant")
            mock_resolve.assert_not_called()

    def test_invalidate_cache(self) -> None:
        from workers.billing.middleware import _cache

        _cache["t-1"] = 9999999999.0
        _cache["t-2"] = 9999999999.0
        invalidate_cache("t-1")
        assert "t-1" not in _cache
        assert _cache.get("t-2") is not None
        invalidate_cache()
        assert len(_cache) == 0

    def test_connect_middleware_smoke(self) -> None:
        connect_tier_middleware()


# ===========================================================================
# Periodic Recalculation Task Tests
# ===========================================================================


class TestPeriodicRecalculation:
    @patch("workers.billing.tiers._get_redis")
    def test_recalculate_empty(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        result = recalculate_pql_scores()
        assert result["processed"] == 0

    @patch("workers.billing.tiers._get_redis")
    def test_recalculate_with_tenants(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:t-1", "usage", "5")
        mc.hset("syntaro:tiers:t-1", "verified", "3")
        mc.hset("syntaro:tiers:t-2", "usage", "2")
        mc.hset("syntaro:tiers:t-2", "verified", "1")
        mock_get_redis.return_value = mc

        result = recalculate_pql_scores()

        assert result["processed"] == 2
        assert result["errors"] == 0

        raw1 = mc.get("syntaro:pql:t-1")
        assert raw1 is not None
        data1 = json.loads(raw1)
        assert data1["score"] == 11.0

        raw2 = mc.get("syntaro:pql:t-2")
        assert raw2 is not None
        data2 = json.loads(raw2)
        assert data2["score"] == 4.0


# ===========================================================================
# Result Type Serialization Tests
# ===========================================================================


class TestResultSerialization:
    def test_nudge_result_roundtrip(self) -> None:
        r = NudgeResult(True, "t-1", "free", 8, 10, 2, message="Upgrade now")
        d = r.to_dict()
        assert d["should_nudge"] is True
        assert d["tenant_id"] == "t-1"
        assert d["message"] == "Upgrade now"

    def test_wall_result_roundtrip(self) -> None:
        r = WallResult(True, "t-1", "free", 10, 10, reason="At limit")
        d = r.to_dict()
        assert d["blocked"] is True
        assert d["reason"] == "At limit"

    def test_inactivity_result_roundtrip(self) -> None:
        r = InactivityResult(True, "t-1", inactive_days=15, alert="Come back!")
        d = r.to_dict()
        assert d["is_inactive"] is True
        assert d["inactive_days"] == 15
        assert d["alert"] == "Come back!"

    def test_nudge_result_repr(self) -> None:
        r = NudgeResult(True, "t-1", "free", 8, 10, 2)
        assert "should_nudge=True" in repr(r)

    def test_wall_result_repr(self) -> None:
        r = WallResult(True, "t-1", "free", 10, 10)
        assert "blocked=True" in repr(r)

    def test_inactivity_result_repr(self) -> None:
        r = InactivityResult(True, "t-1", inactive_days=15)
        assert "is_inactive=True" in repr(r)


# ===========================================================================
# Edge Cases
# ===========================================================================


class TestTierEdgeCases:
    @patch("workers.billing.tiers._get_redis")
    def test_special_chars_in_tenant_id(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        count = increment_tier_usage("tenant/with:special@chars!")
        assert count == 1

    @patch("workers.billing.tiers._get_redis")
    def test_multiple_tenants_independent(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mock_get_redis.return_value = mc
        increment_tier_usage("tenant-a")
        increment_tier_usage("tenant-a")
        increment_tier_usage("tenant-b")
        assert get_tier_usage("tenant-a")["usage"] == 2
        assert get_tier_usage("tenant-b")["usage"] == 1

    @patch("workers.billing.tiers._get_redis")
    def test_usage_display_for_exhausted_free_tier(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:exhausted", "usage", "10")
        mock_get_redis.return_value = mc
        result = get_tier_usage("exhausted")
        assert result["remaining"] == 0
        assert "10/10" in result["display"]

    @patch("workers.billing.tiers._get_redis")
    def test_pql_score_none_when_no_data(self, mock_get_redis: MagicMock) -> None:
        mock_get_redis.return_value = DictRedisMock()
        score = compute_pql_score("empty", usage=0, verified=0)
        assert score.score == 0.0

    def test_tier_limit_exceeded_exception(self) -> None:
        exc = TierLimitExceeded("t-1", "free", 10, 10, "At limit")
        assert exc.tenant_id == "t-1"
        assert exc.tier == "free"
        assert "At limit" in str(exc)


# ===========================================================================
# PQL Message Content Tests
# ===========================================================================


class TestPqlMessages:
    @patch("workers.billing.tiers._get_redis")
    def test_nudge_message_contains_upgrade_link(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:nudge-msg", "usage", "8")
        mock_get_redis.return_value = mc
        result = check_nudge("nudge-msg")
        assert result.message is not None
        assert "syntaro.dev/pricing" in result.message
        assert "Solo" in result.message
        assert "$49" in result.message

    @patch("workers.billing.tiers._get_redis")
    def test_wall_message_contains_tier_info(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        mc.hset("syntaro:tiers:wall-msg", "usage", "10")
        mock_get_redis.return_value = mc
        result = check_wall("wall-msg")
        assert result.reason is not None
        assert "limit of 10 fixes" in result.reason
        assert "Solo" in result.reason
        assert "syntaro.dev/pricing" in result.reason

    @patch("workers.billing.tiers._get_redis")
    def test_inactivity_message_contains_reengagement(self, mock_get_redis: MagicMock) -> None:
        mc = DictRedisMock()
        old_ts = int(time.time()) - 20 * 24 * 60 * 60
        mc.hset("syntaro:tiers:inactive-msg", "last_fix_ts", str(old_ts))
        mc.hset("syntaro:tiers:inactive-msg", "usage", "5")
        mock_get_redis.return_value = mc
        result = check_inactivity("inactive-msg")
        assert result.alert is not None
        assert "syntaro:fix" in result.alert
        assert "syntaro.dev" in result.alert
