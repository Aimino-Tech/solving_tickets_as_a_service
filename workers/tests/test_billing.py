"""
Tests for billing integration modules — usage counter and tier enforcement.

Covers:
    workers.billing.usage      — Redis atomic counters, query, Stripe sync
    workers.billing.enforcer   — Pre-flight check, block at limit, warn at 80%
"""

from unittest.mock import MagicMock, patch

import pytest

from workers.billing import enforcer
from workers.billing.usage import (
    _now_iso,
    get_all_usage,
    get_usage,
    get_usage_summary,
    increment_usage,
    reset_usage,
)


# ===========================================================================
# Usage Counter Tests
# ===========================================================================


class TestUsageCounter:
    """Tests for workers.billing.usage — Redis atomic increment and query."""

    def test_increment_usage_creates_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """First increment should create the key with count=1 and period_start."""
        fake_redis = MagicMock()
        fake_redis.hincrby.return_value = 1
        fake_redis.hsetnx.return_value = 1

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        result = increment_usage("tenant-1")

        assert result == 1
        fake_redis.hincrby.assert_called_once_with("stas:billing:usage:tenant-1", "count", 1)
        # Should set period_start on first call
        fake_redis.hsetnx.assert_called_once()
        assert fake_redis.hsetnx.call_args[0][0] == "stas:billing:usage:tenant-1"
        assert fake_redis.hsetnx.call_args[0][1] == "period_start"

    def test_increment_usage_atomic(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Multiple increments should accumulate correctly."""
        fake_redis = MagicMock()
        fake_redis.hincrby.side_effect = [1, 2, 3]  # pipeline returns list

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        increment_usage("tenant-1")
        increment_usage("tenant-1")
        result = increment_usage("tenant-1")

        assert result == 3
        assert fake_redis.hincrby.call_count == 3

    def test_get_usage_returns_zero_for_unknown_tenant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Unknown tenant should return count=0 with no error."""
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {}

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        result = get_usage("unknown-tenant")

        assert result["tenant_id"] == "unknown-tenant"
        assert result["count"] == 0
        assert result["period_start"] is None

    def test_get_usage_returns_stored_values(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Known tenant should return stored count and period_start."""
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {
            "count": "5",
            "period_start": "2026-06-01T00:00:00+00:00",
        }

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        result = get_usage("tenant-1")

        assert result["tenant_id"] == "tenant-1"
        assert result["count"] == 5
        assert result["period_start"] == "2026-06-01T00:00:00+00:00"

    def test_reset_usage_deletes_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Reset should delete the Redis key for the tenant."""
        fake_redis = MagicMock()
        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        reset_usage("tenant-1")

        fake_redis.delete.assert_called_once_with("stas:billing:usage:tenant-1")

    def test_get_all_usage_scans_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """get_all_usage should scan and return all tenant usage records."""
        fake_redis = MagicMock()
        # Simulate SCAN returning two keys, then done
        fake_redis.scan.side_effect = [
            (0, ["stas:billing:usage:tenant-a", "stas:billing:usage:tenant-b"]),
        ]
        fake_redis.hgetall.side_effect = [
            {"count": "3", "period_start": "2026-06-01T00:00:00"},
            {"count": "7", "period_start": "2026-06-01T00:00:00"},
        ]

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        results = get_all_usage()

        assert len(results) == 2
        assert results[0]["tenant_id"] == "tenant-a"
        assert results[0]["count"] == 3
        assert results[1]["tenant_id"] == "tenant-b"
        assert results[1]["count"] == 7

    def test_get_all_usage_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """No usage keys should return empty list."""
        fake_redis = MagicMock()
        fake_redis.scan.return_value = (0, [])

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)

        results = get_all_usage()
        assert results == []

    def test_increment_usage_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Redis failure should return 0 without raising."""
        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: None)

        result = increment_usage("tenant-1")
        assert result == 0

    def test_get_usage_summary_computes_remaining(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """get_usage_summary should compute remaining = max_issues - count."""
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {
            "count": "3",
            "period_start": "2026-06-01T00:00:00",
        }

        monkeypatch.setattr("workers.billing.usage._get_redis", lambda: fake_redis)
        monkeypatch.setattr("workers.billing.usage._resolve_tier", lambda tid: "free")

        result = get_usage_summary("tenant-1")

        assert result["tenant_id"] == "tenant-1"
        assert result["count"] == 3
        assert result["tier"] == "free"
        assert result["remaining"] == 7  # free = 10 max

    def test_sync_usage_to_stripe_skips_zero(self) -> None:
        """sync_usage_to_stripe should skip tenants with 0 count."""
        with (
            patch("workers.billing.usage.get_all_usage") as mock_get_all,
            patch("workers.billing.usage._report_usage_to_stripe") as mock_report,
            patch("workers.billing.usage.reset_usage") as mock_reset,
        ):
            from workers.billing.usage import sync_usage_to_stripe

            mock_get_all.return_value = [
                {"tenant_id": "tenant-a", "count": 0, "period_start": None},
                {"tenant_id": "tenant-b", "count": 0, "period_start": None},
            ]

            result = sync_usage_to_stripe()

            assert result["skipped"] == 2
            assert result["synced"] == 0
            assert result["failed"] == 0
            mock_report.assert_not_called()
            mock_reset.assert_not_called()

    def test_sync_usage_to_stripe_reports_and_resets(self) -> None:
        """sync_usage_to_stripe should report non-zero counters and reset them."""
        with (
            patch("workers.billing.usage.get_all_usage") as mock_get_all,
            patch("workers.billing.usage._report_usage_to_stripe") as mock_report,
            patch("workers.billing.usage.reset_usage") as mock_reset,
        ):
            from workers.billing.usage import sync_usage_to_stripe

            mock_get_all.return_value = [
                {"tenant_id": "tenant-a", "count": 5, "period_start": "2026-06-01T00:00:00"},
                {"tenant_id": "tenant-b", "count": 3, "period_start": "2026-06-01T00:00:00"},
            ]
            mock_report.return_value = True

            result = sync_usage_to_stripe()

            assert result["synced"] == 2
            assert result["skipped"] == 0
            assert result["failed"] == 0
            assert mock_report.call_count == 2
            assert mock_reset.call_count == 2

    def test_sync_usage_to_stripe_records_failures(self) -> None:
        """sync_usage_to_stripe should count failures without crashing."""
        with (
            patch("workers.billing.usage.get_all_usage") as mock_get_all,
            patch("workers.billing.usage._report_usage_to_stripe") as mock_report,
            patch("workers.billing.usage.reset_usage") as mock_reset,
        ):
            from workers.billing.usage import sync_usage_to_stripe

            mock_get_all.return_value = [
                {"tenant_id": "tenant-a", "count": 5, "period_start": "2026-06-01T00:00:00"},
                {"tenant_id": "tenant-b", "count": 3, "period_start": "2026-06-01T00:00:00"},
            ]
            mock_report.side_effect = [True, False]

            result = sync_usage_to_stripe()

            assert result["synced"] == 1
            assert result["failed"] == 1
            assert result["skipped"] == 0
            # Only successfully synced tenant should be reset
            assert mock_reset.call_count == 1

    def test_now_iso_format(self) -> None:
        """_now_iso() should return valid ISO 8601."""
        result = _now_iso()
        assert "T" in result
        assert result.endswith("+00:00") or "+" in result


# ===========================================================================
# Tier Enforcement Tests
# ===========================================================================


class TestTierEnforcement:
    """Tests for workers.billing.enforcer — pre-flight tier check."""

    def test_check_and_block_allows_free_under_limit(self) -> None:
        """Free tier under limit should be allowed."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            from workers.billing.usage import increment_usage

            mock_get_usage.return_value = {"tenant_id": "t1", "count": 3, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is True
            assert result.tier == "free"
            assert result.usage == 3
            assert result.remaining == 7  # free = 10
            assert result.blocked_reason is None
            assert result.warning is None

    def test_check_and_block_blocks_at_limit(self) -> None:
        """Free tier at limit should be blocked with upgrade prompt."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 10, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is False
            assert result.usage == 10
            assert result.remaining == 0
            assert result.blocked_reason is not None
            assert "Free" in result.blocked_reason
            assert "Solo" in result.blocked_reason

    def test_check_and_block_blocks_over_limit(self) -> None:
        """Usage over limit should be blocked."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 15, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is False
            assert result.blocked_reason is not None

    def test_check_and_block_pro_allows_under_limit(self) -> None:
        """Pro tier under limit should be allowed."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 50, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="pro")

            assert result.allowed is True
            assert result.tier == "pro"
            assert result.remaining == 50  # pro = 100

    def test_check_and_block_pro_blocks_at_limit(self) -> None:
        """Pro tier at limit should be blocked with pro upgrade prompt."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 100, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="pro")

            assert result.allowed is False
            assert result.blocked_reason is not None
            assert "Solo" in result.blocked_reason or "Team" in result.blocked_reason

    def test_check_and_block_team_blocks_at_limit(self) -> None:
        """Team tier at limit should mention Enterprise."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 500, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="team")

            assert result.allowed is False
            assert result.blocked_reason is not None
            assert "Enterprise" in result.blocked_reason

    def test_enterprise_always_allowed(self) -> None:
        """Enterprise tier should never be blocked."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 999999, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="enterprise")

            assert result.allowed is True
            assert result.remaining == -1  # unlimited
            assert result.blocked_reason is None
            assert result.warning is None

    def test_warns_at_80_percent(self) -> None:
        """Free tier at 80% should allow but set warning."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 8, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is True
            assert result.warning is not None
            assert "80%" in result.warning or "8/10" in result.warning

    def test_no_warning_below_80_percent(self) -> None:
        """Free tier at 70% should not warn."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 7, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is True
            assert result.warning is None

    def test_fail_open_on_redis_error(self) -> None:
        """Redis failure should allow through with a warning."""
        with patch("workers.billing.enforcer._get_usage", side_effect=Exception("Redis down")):
            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is True
            assert result.warning is not None
            assert "Unable to verify usage" in result.warning

    def test_unknown_tier_defaults_to_free(self) -> None:
        """Unknown tier should default to free limits."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 5, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="premium_gold")

            assert result.tier == "free"
            assert result.limit == 10

    def test_to_dict_serializable(self) -> None:
        """EnforcementResult.to_dict() should return a JSON-serialisable dict."""
        result = enforcer.EnforcementResult(
            allowed=False,
            tenant_id="t1",
            tier="free",
            usage=10,
            limit=10,
            remaining=0,
            blocked_reason="Upgrade needed",
        )

        d = result.to_dict()
        assert d["allowed"] is False
        assert d["tenant_id"] == "t1"
        assert d["blocked_reason"] == "Upgrade needed"

        import json

        serialised = json.dumps(d)
        assert "Upgrade needed" in serialised

    def test_warning_for_pro_at_80_percent(self) -> None:
        """Pro tier at 80% should warn about upcoming limit."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 80, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="pro")

            assert result.allowed is True
            assert result.warning is not None
            assert "80" in result.warning
            assert "Pro" in result.warning or "pro" in result.warning


# ===========================================================================
# Edge Cases
# ===========================================================================


class TestBillingEdgeCases:
    """Edge cases for billing enforcer and usage counter."""

    def test_usage_at_exactly_threshold(self) -> None:
        """Usage at exactly 80% should produce a warning."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 8, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.warning is not None

    def test_usage_one_below_limit(self) -> None:
        """Usage one below limit should be allowed."""
        with patch("workers.billing.enforcer._get_usage") as mock_get_usage:
            mock_get_usage.return_value = {"tenant_id": "t1", "count": 9, "period_start": None}

            result = enforcer.check_and_block("t1", tier_override="free")

            assert result.allowed is True
            assert result.remaining == 1

    def test_usage_with_special_chars_tenant_id(self) -> None:
        """Tenant IDs with special characters should not break Redis keys."""
        fake_redis = MagicMock()
        fake_redis.hincrby.return_value = 1
        fake_redis.hsetnx.return_value = 1

        import workers.billing.usage as usage_mod

        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr(usage_mod, "_get_redis", lambda: fake_redis)

        result = increment_usage("tenant@example.com:123")
        assert result == 1

        monkeypatch.undo()

    def test_stripe_report_failure_non_fatal(self) -> None:
        """A Stripe reporting failure should not crash the sync task."""
        with (
            patch("workers.billing.usage.get_all_usage") as mock_get_all,
            patch("workers.billing.usage._report_usage_to_stripe") as mock_report,
            patch("workers.billing.usage.reset_usage") as mock_reset,
        ):
            from workers.billing.usage import sync_usage_to_stripe

            mock_get_all.return_value = [
                {"tenant_id": "tenant-a", "count": 5, "period_start": "2026-06-01T00:00:00"},
            ]
            mock_report.side_effect = Exception("Stripe API error")

            # Should not raise
            result = sync_usage_to_stripe()

            assert result["failed"] == 1
            assert result["synced"] == 0
            # Counter should not be reset on failure
            mock_reset.assert_not_called()
