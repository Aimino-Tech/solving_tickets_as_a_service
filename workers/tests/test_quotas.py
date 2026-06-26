"""
Tests for unified quota enforcement — tier limits across resource types.

Covers:
    workers.billing.quotas       -- Tier limit definitions, resolve_tier(),
                                    tier_limit(), is_unlimited(), check_quota(),
                                    QuotaResult serialization
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.billing.quotas import (
    TIER_LIMITS,
    QuotaResult,
    check_quota,
    is_unlimited,
    resolve_tier,
    tier_limit,
)


# ===========================================================================
# Tier Limit Definition Tests
# ===========================================================================


class TestTierLimitDefinitions:
    """Canonical tier limits match the documented values."""

    def test_free_tier_limits(self) -> None:
        limits = TIER_LIMITS["free"]
        assert limits["fixes"] == 10
        assert limits["storage"] == 512 * 1024 * 1024
        assert limits["workspaces"] == 5
        assert limits["api_rate"] == 10

    def test_solo_tier_limits(self) -> None:
        limits = TIER_LIMITS["solo"]
        assert limits["fixes"] == 100
        assert limits["storage"] == 2 * 1024 * 1024 * 1024
        assert limits["workspaces"] == 20
        assert limits["api_rate"] == 60

    def test_team_tier_limits(self) -> None:
        limits = TIER_LIMITS["team"]
        assert limits["fixes"] == 500
        assert limits["storage"] == 5 * 1024 * 1024 * 1024
        assert limits["workspaces"] == 50
        assert limits["api_rate"] == 300

    def test_enterprise_tier_limits(self) -> None:
        limits = TIER_LIMITS["enterprise"]
        assert limits["fixes"] == -1
        assert limits["storage"] == 10 * 1024 * 1024 * 1024
        assert limits["workspaces"] == 100
        assert limits["api_rate"] == 1000

    def test_all_tiers_have_same_resource_keys(self) -> None:
        """Every tier must define the same set of resource types."""
        keys = [frozenset(limits) for limits in TIER_LIMITS.values()]
        reference = keys[0]
        for k in keys[1:]:
            assert k == reference, f"Resource key mismatch: {k} != {reference}"

    def test_tier_limit_raises_on_unknown_resource(self) -> None:
        with pytest.raises(ValueError, match="Unknown resource type"):
            tier_limit("free", "nonexistent_resource")

    def test_tier_limit_defaults_on_unknown_tier(self) -> None:
        """Unknown tier falls back to free limits."""
        assert tier_limit("platinum", "fixes") == 10  # free tier limit

    def test_is_unlimited_returns_true(self) -> None:
        assert is_unlimited(-1, "fixes") is True

    def test_is_unlimited_returns_false_for_limited(self) -> None:
        assert is_unlimited(10, "fixes") is False

    def test_is_unlimited_returns_false_for_non_unlimited_resource(self) -> None:
        """workspaces and api_rate don't support -1 = unlimited."""
        assert is_unlimited(-1, "workspaces") is False
        assert is_unlimited(-1, "api_rate") is False


# ===========================================================================
# Tier Resolution Tests
# ===========================================================================


class TestTierResolution:
    """resolve_tier() resolves tenant ID to tier name."""

    def test_defaults_to_free(self) -> None:
        assert resolve_tier("unknown-tenant") == "free"

    def test_tier_override(self) -> None:
        assert resolve_tier("t-1", tier_override="solo") == "solo"
        assert resolve_tier("t-1", tier_override="TEAM") == "team"
        assert resolve_tier("t-1", tier_override="Enterprise") == "enterprise"

    def test_tier_override_unknown_falls_back(self) -> None:
        """Unknown tier_override should log warning and return free."""
        assert resolve_tier("t-1", tier_override="premium_gold") == "free"

    def test_via_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TENANT_ACME_CORP_TIER", "solo")
        assert resolve_tier("acme-corp") == "solo"

    def test_env_var_case_normalized(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TENANT_MY_TENANT_TIER", "TEAM")
        assert resolve_tier("my-tenant") == "team"

    def test_tier_override_takes_precedence_over_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TENANT_OVERRIDE_ME_TIER", "free")
        assert resolve_tier("override-me", tier_override="enterprise") == "enterprise"


# ===========================================================================
# QuotaResult Serialization Tests
# ===========================================================================


class TestQuotaResult:
    """QuotaResult dataclass serialization and helpers."""

    def test_allowed_result(self) -> None:
        r = QuotaResult(
            allowed=True,
            tenant_id="t-1",
            tier="free",
            resource="fixes",
            usage=3,
            limit=10,
            remaining=7,
        )
        assert r.allowed is True
        assert r.blocked_reason is None

    def test_blocked_result(self) -> None:
        r = QuotaResult(
            allowed=False,
            tenant_id="t-1",
            tier="free",
            resource="fixes",
            usage=10,
            limit=10,
            remaining=0,
            blocked_reason="Upgrade needed",
        )
        assert r.allowed is False
        assert r.blocked_reason == "Upgrade needed"

    def test_to_dict_serializable(self) -> None:
        r = QuotaResult(
            allowed=False,
            tenant_id="t-1",
            tier="free",
            resource="fixes",
            usage=10,
            limit=10,
            remaining=0,
            blocked_reason="Upgrade needed",
            warning="Approaching limit",
        )
        d = r.to_dict()
        assert d["allowed"] is False
        assert d["tenant_id"] == "t-1"
        assert d["blocked_reason"] == "Upgrade needed"
        assert d["warning"] == "Approaching limit"

        import json

        serialised = json.dumps(d)
        assert "Upgrade needed" in serialised

    def test_repr(self) -> None:
        r = QuotaResult(True, "t-1", "free", "fixes")
        assert "QuotaResult(" in repr(r)
        assert "allowed=True" in repr(r)
        assert "tier=free" in repr(r)
        assert "fixes" in repr(r)

    def test_to_dict_unlimited(self) -> None:
        r = QuotaResult(
            allowed=True,
            tenant_id="t-1",
            tier="enterprise",
            resource="fixes",
            usage=0,
            limit=-1,
            remaining=-1,
        )
        d = r.to_dict()
        assert d["limit"] == -1
        assert d["remaining"] == -1


# ===========================================================================
# check_quota() — Fixes Resource Tests
# ===========================================================================


class TestCheckQuotaFixes:
    """check_quota() enforcement for the ``fixes`` resource."""

    def test_allows_free_under_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=3)
        assert result.allowed is True
        assert result.tier == "free"
        assert result.usage == 3
        assert result.remaining == 7
        assert result.blocked_reason is None
        assert result.warning is None

    def test_blocks_at_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=10)
        assert result.allowed is False
        assert result.usage == 10
        assert result.remaining == 0
        assert result.blocked_reason is not None
        assert "Free" in result.blocked_reason
        assert "Solo" in result.blocked_reason

    def test_blocks_over_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=15)
        assert result.allowed is False
        assert result.blocked_reason is not None

    def test_allows_solo_under_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="solo"):
            result = check_quota("t-1", "fixes", usage=50)
        assert result.allowed is True
        assert result.tier == "solo"
        assert result.remaining == 50

    def test_blocks_solo_at_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="solo"):
            result = check_quota("t-1", "fixes", usage=100)
        assert result.allowed is False
        assert result.blocked_reason is not None
        assert "Solo" in result.blocked_reason
        assert "Team" in result.blocked_reason

    def test_blocks_team_at_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="team"):
            result = check_quota("t-1", "fixes", usage=500)
        assert result.allowed is False
        assert result.blocked_reason is not None
        assert "Enterprise" in result.blocked_reason

    def test_enterprise_always_allowed(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="enterprise"):
            result = check_quota("t-1", "fixes", usage=99999)
        assert result.allowed is True
        assert result.remaining == -1
        assert result.blocked_reason is None
        assert result.warning is None

    def test_warns_at_80_percent(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=8)
        assert result.allowed is True
        assert result.warning is not None
        assert "80%" in result.warning or "8/10" in result.warning

    def test_no_warning_below_80_percent(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=7)
        assert result.allowed is True
        assert result.warning is None

    def test_warns_for_solo_at_80_percent(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="solo"):
            result = check_quota("t-1", "fixes", usage=80)
        assert result.allowed is True
        assert result.warning is not None
        assert "80" in result.warning

    def test_usage_one_below_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=9)
        assert result.allowed is True
        assert result.remaining == 1

    def test_usage_at_exactly_threshold(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=8)
        assert result.warning is not None


# ===========================================================================
# check_quota() — Storage Resource Tests
# ===========================================================================


class TestCheckQuotaStorage:
    """check_quota() enforcement for the ``storage`` resource."""

    def test_free_allows_under_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "storage", usage=256 * 1024 * 1024)
        assert result.allowed is True
        assert result.remaining == 256 * 1024 * 1024

    def test_free_blocks_at_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "storage", usage=512 * 1024 * 1024)
        assert result.allowed is False

    def test_enterprise_has_finite_storage_limit(self) -> None:
        """Enterprise storage is finite (10 GB), not unlimited."""
        with patch("workers.billing.quotas.resolve_tier", return_value="enterprise"):
            result = check_quota("t-1", "storage", usage=5 * 1024 * 1024 * 1024)
            assert result.allowed is True
            assert result.limit == 10 * 1024 * 1024 * 1024

            result = check_quota("t-1", "storage", usage=10 * 1024 * 1024 * 1024)
            assert result.allowed is False

    def test_warns_at_80_percent_storage(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            limit = 512 * 1024 * 1024
            at_80 = int(limit * 0.8)
            result = check_quota("t-1", "storage", usage=at_80)
            assert result.warning is not None
            assert "80" in result.warning


# ===========================================================================
# check_quota() — Workspaces & API Rate Resources
# ===========================================================================


class TestCheckQuotaWorkspaces:
    """check_quota() enforcement for the ``workspaces`` resource."""

    def test_free_allows_under_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "workspaces", usage=3)
        assert result.allowed is True
        assert result.remaining == 2

    def test_free_blocks_at_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "workspaces", usage=5)
        assert result.allowed is False

    def test_enterprise_allows_many(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="enterprise"):
            result = check_quota("t-1", "workspaces", usage=99)
        assert result.allowed is True
        assert result.remaining == 1


class TestCheckQuotaApiRate:
    """check_quota() enforcement for the ``api_rate`` resource."""

    def test_free_allows_under_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "api_rate", usage=5)
        assert result.allowed is True
        assert result.remaining == 5

    def test_free_blocks_at_limit(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "api_rate", usage=10)
        assert result.allowed is False

    def test_enterprise_allows_high_rate(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="enterprise"):
            result = check_quota("t-1", "api_rate", usage=999)
        assert result.allowed is True
        assert result.remaining == 1

    def test_enterprise_blocks_over_rate(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="enterprise"):
            result = check_quota("t-1", "api_rate", usage=1001)
        assert result.allowed is False


# ===========================================================================
# check_quota() — Usage Auto-Resolution via Redis
# ===========================================================================


class TestCheckQuotaUsageResolution:
    """check_quota() auto-reads usage from Redis when usage=None."""

    def test_reads_usage_from_redis(self) -> None:
        with (
            patch("workers.billing.quotas.resolve_tier", return_value="free"),
            patch("workers.billing.usage.get_usage") as mock_get_usage,
        ):
            mock_get_usage.return_value = {"tenant_id": "t-1", "count": 3, "period_start": None}
            result = check_quota("t-1", "fixes")
        assert result.usage == 3
        assert result.remaining == 7
        assert result.allowed is True

    def test_fail_open_on_redis_error(self) -> None:
        with (
            patch("workers.billing.quotas.resolve_tier", return_value="free"),
            patch("workers.billing.usage.get_usage", side_effect=Exception("Redis down")),
        ):
            result = check_quota("t-1", "fixes")
        assert result.allowed is True
        assert result.warning is not None
        assert "Unable to verify usage" in result.warning

    def test_defaults_to_zero_when_no_redis_record(self) -> None:
        with (
            patch("workers.billing.quotas.resolve_tier", return_value="free"),
            patch("workers.billing.usage.get_usage") as mock_get_usage,
        ):
            mock_get_usage.return_value = {"tenant_id": "t-1", "count": 0, "period_start": None}
            result = check_quota("t-1", "fixes")
        assert result.usage == 0
        assert result.remaining == 10
        assert result.allowed is True


# ===========================================================================
# check_quota() — Edge Cases
# ===========================================================================


class TestCheckQuotaEdgeCases:
    """Edge cases for quota enforcement."""

    def test_unknown_tier_defaults_to_free(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=5)
        assert result.tier == "free"
        assert result.limit == 10

    def test_tier_override_applied(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="team"):
            result = check_quota("t-1", "fixes", usage=200)
        assert result.tier == "team"
        assert result.allowed is True

    def test_negative_usage_treated_as_zero_or_blocks(self) -> None:
        """Negative usage may occur on race conditions; should still allow."""
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=-1)
        assert result.allowed is True
        assert result.usage == -1
        assert result.remaining == 11  # max(0, 10 - (-1)) = 11

    def test_unknown_resource_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown resource type"):
            check_quota("t-1", "nonexistent", usage=1)

    def test_allowed_result_no_side_effects(self) -> None:
        """Allowed result should have blocked_reason=None, warning=None."""
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=1)
        assert result.allowed is True
        assert result.blocked_reason is None
        assert result.warning is None

    def test_resource_label_in_blocked_message(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=10)
        assert result.blocked_reason is not None
        assert "fixes" in result.blocked_reason
        assert "10" in result.blocked_reason

    def test_resource_label_in_warning_message(self) -> None:
        with patch("workers.billing.quotas.resolve_tier", return_value="free"):
            result = check_quota("t-1", "fixes", usage=8)
        assert result.warning is not None
        assert "fixes" in result.warning or "Free" in result.warning
