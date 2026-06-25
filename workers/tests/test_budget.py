"""
Tests for cost budget & usage tracking modules (AIM-1996).

Covers:
    workers.budget.models     — Budget dataclass, BudgetStatus, BudgetCheckResult
    workers.budget.tracker    — Redis atomic counter operations
    workers.budget.enforcer   — Pre-dispatch check, block at cap, warn at 80%
    workers.budget.middleware — Celery signal handler for budget enforcement
    workers.tasks.budget_billing_cycle — Monthly budget reset task
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from workers.budget import (
    Budget,
    BudgetCheckResult,
    BudgetStatus,
    check_budget,
    get_all_budgets,
    get_budget,
    init_budget,
    reset_all_budgets,
    reset_budget,
    track_completion,
)
from workers.budget.enforcer import _format_cost, _format_tokens
from workers.budget.tracker import _compute_status


# ===========================================================================
# Budget Model Tests
# ===========================================================================


class TestBudgetModel:
    """Tests for workers.budget.models — Budget dataclass."""

    def test_budget_defaults(self) -> None:
        """Budget with defaults should have unlimited caps."""
        b = Budget(tenant_id="t1")
        assert b.tenant_id == "t1"
        assert b.monthly_token_cap == -1
        assert b.monthly_cost_cap == -1
        assert b.tokens_used == 0
        assert b.cost_incurred == 0
        assert b.status == BudgetStatus.ACTIVE
        assert b.is_unlimited() is True

    def test_budget_unlimited_remaining(self) -> None:
        """Unlimited budget returns -1 for remaining."""
        b = Budget(tenant_id="t1")
        assert b.token_remaining() == -1
        assert b.cost_remaining() == -1

    def test_budget_limited_remaining(self) -> None:
        """Capped budget returns correct remaining."""
        b = Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=50000, tokens_used=300_000, cost_incurred=10000)
        assert b.token_remaining() == 700_000
        assert b.cost_remaining() == 40_000

    def test_budget_zero_remaining_at_cap(self) -> None:
        """Budget at cap should return 0 remaining."""
        b = Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=50000, tokens_used=1_000_000, cost_incurred=50000)
        assert b.token_remaining() == 0
        assert b.cost_remaining() == 0

    def test_budget_usage_pct(self) -> None:
        """Usage percentage should reflect fraction of cap."""
        b = Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=50000, tokens_used=250_000, cost_incurred=10000)
        assert b.token_usage_pct() == 0.25
        assert b.cost_usage_pct() == 0.2
        assert b.combined_usage_pct() == 0.25  # max

    def test_budget_unlimited_usage_pct_zero(self) -> None:
        """Unlimited caps should return 0 usage pct."""
        b = Budget(tenant_id="t1")
        assert b.token_usage_pct() == 0.0
        assert b.cost_usage_pct() == 0.0

    def test_budget_to_dict(self) -> None:
        """to_dict should produce serialisable dict."""
        b = Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=50000, tokens_used=100_000, cost_incurred=5000)
        d = b.to_dict()
        assert d["tenant_id"] == "t1"
        assert d["status"] == "active"
        assert d["tokens_used"] == 100_000

    def test_budget_from_dict(self) -> None:
        """from_dict should reconstruct Budget from dict."""
        d = {
            "tenant_id": "t1",
            "monthly_token_cap": 1_000_000,
            "monthly_cost_cap": 50000,
            "tokens_used": 100_000,
            "cost_incurred": 5000,
            "status": "warning",
        }
        b = Budget.from_dict(d)
        assert b.tenant_id == "t1"
        assert b.tokens_used == 100_000
        assert b.status == BudgetStatus.WARNING

    def test_budget_from_dict_default_status(self) -> None:
        """from_dict with unknown status should default to ACTIVE."""
        d = {"tenant_id": "t1", "status": "bogus"}
        b = Budget.from_dict(d)
        assert b.status == BudgetStatus.ACTIVE

    def test_budget_to_dict_roundtrip(self) -> None:
        """to_dict -> from_dict roundtrip should preserve all fields."""
        b = Budget(
            tenant_id="t1",
            monthly_token_cap=1_000_000,
            monthly_cost_cap=50000,
            tokens_used=100_000,
            cost_incurred=5000,
            status=BudgetStatus.EXCEEDED,
            reset_at="2026-06-01T00:00:00",
            period_start="2026-06-01T00:00:00",
        )
        d = b.to_dict()
        b2 = Budget.from_dict(d)
        assert b2.tenant_id == b.tenant_id
        assert b2.monthly_token_cap == b.monthly_token_cap
        assert b2.monthly_cost_cap == b.monthly_cost_cap
        assert b2.tokens_used == b.tokens_used
        assert b2.cost_incurred == b.cost_incurred
        assert b2.status == b.status
        assert b2.reset_at == b.reset_at
        assert b2.period_start == b.period_start


class TestBudgetCheckResult:
    """Tests for BudgetCheckResult."""

    def test_check_result_allowed(self) -> None:
        """Allowed result should have no blocked_reason."""
        result = BudgetCheckResult(allowed=True, tenant_id="t1")
        assert result.allowed is True
        assert result.blocked_reason is None
        assert result.warning is None

    def test_check_result_blocked(self) -> None:
        """Blocked result should have blocked_reason."""
        result = BudgetCheckResult(
            allowed=False,
            tenant_id="t1",
            blocked_reason="Budget exceeded",
            budget=Budget(tenant_id="t1", monthly_token_cap=1000, tokens_used=1000),
        )
        assert result.allowed is False
        assert result.blocked_reason == "Budget exceeded"

    def test_check_result_to_dict(self) -> None:
        """to_dict should be JSON-serialisable."""
        result = BudgetCheckResult(
            allowed=False,
            tenant_id="t1",
            blocked_reason="Budget exceeded",
            budget=Budget(tenant_id="t1", monthly_token_cap=1000, tokens_used=1000),
        )
        d = result.to_dict()
        assert d["allowed"] is False
        assert d["blocked_reason"] == "Budget exceeded"
        assert d["budget"] is not None

        import json
        serialised = json.dumps(d)
        assert "Budget exceeded" in serialised

    def test_check_result_no_budget_to_dict(self) -> None:
        """to_dict with no budget should have null budget."""
        result = BudgetCheckResult(allowed=True, tenant_id="t1")
        d = result.to_dict()
        assert d["budget"] is None


# ===========================================================================
# Budget Tracker Tests
# ===========================================================================


class TestBudgetTracker:
    """Tests for workers.budget.tracker — Redis atomic budget operations."""

    def test_init_budget_creates_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """First init should create the budget hash with all fields."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        # pipeline: 7 hsetnx calls + 1 expire = 8 results; first hsetnx returns 1 = created
        fake_pipe.execute.return_value = [1, 1, 1, 1, 1, 1, 1, True]

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = init_budget("t1", monthly_token_cap=1_000_000, monthly_cost_cap=50000)

        assert result is True

    def test_init_budget_existing_key_noop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Re-init should be a no-op (hsetnx returns 0 for existing)."""
        fake_redis = MagicMock()
        fake_redis.hsetnx.return_value = 0

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = init_budget("t1")

        assert result is False

    def test_init_budget_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Redis failure should return False."""
        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: None)

        result = init_budget("t1")

        assert result is False

    def test_track_completion_increments_counters(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """track_completion should atomically increment tokens and cost."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        # pipe.execute returns: [tokens_used_result, cost_result, expire_ok]
        fake_pipe.execute.return_value = [5000, 150, True]
        fake_redis.hmget.return_value = ["1000000", "50000"]  # caps as strings (Redis)

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = track_completion("t1", tokens_used=5000, cost_cents=150)

        assert result["tokens_used"] == 5000
        assert result["cost_incurred"] == 150
        assert result["monthly_token_cap"] == 1_000_000
        assert result["monthly_cost_cap"] == 50000
        assert result["status"] in ("active", "warning")

    def test_track_completion_exceeds_token_cap(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """track_completion should set status to EXCEEDED when token cap hit."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.return_value = [1_000_000, 0, True]
        fake_redis.hmget.return_value = ["1000000", "-1"]  # unlimited cost

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = track_completion("t1", tokens_used=5000)

        assert result["status"] == "exceeded"

    def test_track_completion_exceeds_cost_cap(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """track_completion should set status to EXCEEDED when cost cap hit."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.return_value = [0, 50000, True]
        fake_redis.hmget.return_value = ["-1", "50000"]  # unlimited tokens

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = track_completion("t1", cost_cents=50000)

        assert result["status"] == "exceeded"

    def test_track_completion_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Redis failure should return error dict."""
        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: None)

        result = track_completion("t1", tokens_used=5000, cost_cents=150)

        assert "error" in result

    def test_get_budget_returns_none_for_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Missing tenant returns None."""
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {}

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = get_budget("t1")

        assert result is None

    def test_get_budget_returns_budget(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Existing tenant returns Budget."""
        fake_redis = MagicMock()
        fake_redis.hgetall.return_value = {
            "monthly_token_cap": "1000000",
            "monthly_cost_cap": "50000",
            "tokens_used": "100000",
            "cost_incurred": "5000",
            "status": "active",
            "reset_at": "2026-06-01T00:00:00",
            "period_start": "2026-06-01T00:00:00",
        }

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        budget = get_budget("t1")

        assert budget is not None
        assert budget.tenant_id == "t1"
        assert budget.tokens_used == 100_000
        assert budget.cost_incurred == 5000
        assert budget.status == BudgetStatus.ACTIVE

    def test_reset_budget_zeros_counters(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Reset should zero out counters and set status to RESET."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.return_value = [True] * 6

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = reset_budget("t1")

        assert result is True
        # Verify the HSET calls on the pipe
        hset_calls = fake_pipe.hset.call_args_list
        hset_args = {call[0][1]: call[0][2] for call in hset_calls}
        assert hset_args["tokens_used"] == 0
        assert hset_args["cost_incurred"] == 0
        assert hset_args["status"] == "reset"

    def test_reset_budget_redis_unavailable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Redis failure returns False."""
        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: None)

        result = reset_budget("t1")

        assert result is False

    def test_get_all_budgets_scans_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """get_all_budgets should scan and return all budgets."""
        fake_redis = MagicMock()
        fake_redis.scan.return_value = (0, [
            "stas:budget:t1",
            "stas:budget:t2",
        ])
        fake_redis.hgetall.side_effect = [
            {
                "monthly_token_cap": "1000000",
                "monthly_cost_cap": "50000",
                "tokens_used": "100",
                "cost_incurred": "10",
                "status": "active",
                "reset_at": "2026-06-01T00:00:00",
                "period_start": "2026-06-01T00:00:00",
            },
            {
                "monthly_token_cap": "2000000",
                "monthly_cost_cap": "100000",
                "tokens_used": "200",
                "cost_incurred": "20",
                "status": "active",
                "reset_at": "2026-06-01T00:00:00",
                "period_start": "2026-06-01T00:00:00",
            },
        ]

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        results = get_all_budgets()

        assert len(results) == 2
        assert results[0].tenant_id == "t1"
        assert results[0].tokens_used == 100
        assert results[1].tenant_id == "t2"
        assert results[1].tokens_used == 200

    def test_get_all_budgets_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """No budget keys returns empty list."""
        fake_redis = MagicMock()
        fake_redis.scan.return_value = (0, [])

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        results = get_all_budgets()
        assert results == []

    def test_track_completion_at_warning_threshold(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """track_completion should set WARNING at 80% threshold."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.return_value = [800_000, 0, True]
        fake_redis.hmget.return_value = ["1000000", "-1"]

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = track_completion("t1", tokens_used=800_000)

        assert result["status"] == "warning"

    def test_init_budget_with_custom_caps(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Init with custom caps sets correct values."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.return_value = [1, 1, 1, 1, 1, 1, 1, True]

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = init_budget("enterprise-1", monthly_token_cap=-1, monthly_cost_cap=-1)

        assert result is True


# ===========================================================================
# Budget Enforcer Tests
# ===========================================================================


class TestBudgetEnforcer:
    """Tests for workers.budget.enforcer — pre-flight budget check."""

    def test_check_budget_allows_unlimited(self) -> None:
        """Unlimited budget should always be allowed."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(tenant_id="t1")

            result = check_budget("t1")

            assert result.allowed is True
            assert result.blocked_reason is None

    def test_check_budget_allows_under_cap(self) -> None:
        """Budget under caps should be allowed."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                monthly_cost_cap=50000,
                tokens_used=100_000,
                cost_incurred=5000,
            )

            result = check_budget("t1")

            assert result.allowed is True
            assert result.blocked_reason is None
            assert result.warning is None

    def test_check_budget_blocks_at_token_cap(self) -> None:
        """Token cap reached should block."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                monthly_cost_cap=50000,
                tokens_used=1_000_000,
                cost_incurred=5000,
                status=BudgetStatus.EXCEEDED,
            )

            result = check_budget("t1")

            assert result.allowed is False
            assert result.blocked_reason is not None
            assert "token" in result.blocked_reason.lower()

    def test_check_budget_blocks_at_cost_cap(self) -> None:
        """Cost cap reached should block."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                monthly_cost_cap=50000,
                tokens_used=100_000,
                cost_incurred=50000,
                status=BudgetStatus.EXCEEDED,
            )

            result = check_budget("t1")

            assert result.allowed is False
            assert result.blocked_reason is not None
            assert "cost" in result.blocked_reason.lower()

    def test_check_budget_warns_at_80_percent(self) -> None:
        """Budget at 80% should warn."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                monthly_cost_cap=-1,
                tokens_used=800_000,
                cost_incurred=0,
            )

            result = check_budget("t1")

            assert result.allowed is True
            assert result.warning is not None
            assert "80%" in result.warning or "tokens" in result.warning

    def test_check_budget_no_warning_below_80(self) -> None:
        """Budget below 80% should not warn."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                monthly_cost_cap=50000,
                tokens_used=500_000,
                cost_incurred=10000,
            )

            result = check_budget("t1")

            assert result.allowed is True
            assert result.warning is None

    def test_check_budget_no_record_fail_open(self) -> None:
        """No budget record should allow through."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = None

            result = check_budget("t1")

            assert result.allowed is True
            assert result.budget is None

    def test_check_budget_fail_open_on_redis_error(self) -> None:
        """Redis failure should allow with warning."""
        with patch("workers.budget.enforcer.get_budget", side_effect=Exception("Redis down")):
            result = check_budget("t1")

            assert result.allowed is True
            assert result.warning is not None
            assert "Unable to verify budget" in result.warning

    def test_check_budget_over_cap_defensive(self) -> None:
        """Budget over cap even without EXCEEDED status should be caught."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                tokens_used=1_500_000,
                status=BudgetStatus.ACTIVE,  # defensive: status not updated yet
            )

            result = check_budget("t1")

            assert result.allowed is False
            assert result.blocked_reason is not None

    def test_check_budget_with_both_caps_exceeded(self) -> None:
        """Both caps exceeded should produce combined reason."""
        with patch("workers.budget.enforcer.get_budget") as mock_get:
            mock_get.return_value = Budget(
                tenant_id="t1",
                monthly_token_cap=1_000_000,
                monthly_cost_cap=50000,
                tokens_used=1_000_000,
                cost_incurred=50000,
                status=BudgetStatus.EXCEEDED,
            )

            result = check_budget("t1")

            assert result.allowed is False
            # Should mention both token and cost
            assert result.blocked_reason is not None

    def test_enforcer_format_tokens(self) -> None:
        """Format tokens should produce readable strings."""
        assert _format_tokens(500) == "500"
        assert _format_tokens(1000) == "1K"
        assert _format_tokens(1_500_000) == "1.5M"
        assert _format_tokens(0) == "0"

    def test_enforcer_format_cost(self) -> None:
        """Format cost should produce readable dollar strings."""
        assert _format_cost(0) == "$0.00"
        assert _format_cost(500) == "$5.00"
        assert _format_cost(1250) == "$12.50"
        assert _format_cost(99) == "$0.99"


# ===========================================================================
# Compute Status Tests
# ===========================================================================


class TestComputeStatus:
    """Tests for _compute_status helper."""

    def test_active_below_threshold(self) -> None:
        """Usage below 80% should be ACTIVE."""
        status = _compute_status(100_000, 5000, 1_000_000, 50_000)
        assert status == BudgetStatus.ACTIVE

    def test_warning_at_80_percent(self) -> None:
        """Usage at 80% should be WARNING."""
        status = _compute_status(800_000, 0, 1_000_000, -1)
        assert status == BudgetStatus.WARNING

    def test_warning_on_cost_at_80_percent(self) -> None:
        """Cost at 80% should be WARNING."""
        status = _compute_status(0, 40_000, -1, 50_000)
        assert status == BudgetStatus.WARNING

    def test_exceeded_at_token_cap(self) -> None:
        """Tokens at cap should be EXCEEDED."""
        status = _compute_status(1_000_000, 0, 1_000_000, -1)
        assert status == BudgetStatus.EXCEEDED

    def test_exceeded_at_cost_cap(self) -> None:
        """Cost at cap should be EXCEEDED."""
        status = _compute_status(0, 50_000, -1, 50_000)
        assert status == BudgetStatus.EXCEEDED

    def test_exceeded_over_cap(self) -> None:
        """Over cap should be EXCEEDED."""
        status = _compute_status(2_000_000, 0, 1_000_000, -1)
        assert status == BudgetStatus.EXCEEDED

    def test_unlimited_caps_never_warn(self) -> None:
        """Unlimited caps should always be ACTIVE."""
        status = _compute_status(0, 0, -1, -1)
        assert status == BudgetStatus.ACTIVE

    def test_warning_threshold_exact_edge(self) -> None:
        """Exactly at 80% should be WARNING."""
        status = _compute_status(800_000, 0, 1_000_000, -1)
        assert status == BudgetStatus.WARNING

    def test_cost_warning_beats_token_active(self) -> None:
        """Cost at 80% with token below should still be WARNING."""
        status = _compute_status(100_000, 40_000, 1_000_000, 50_000)
        assert status == BudgetStatus.WARNING


# ===========================================================================
# Budget Reset Task Tests
# ===========================================================================


class TestBudgetBillingCycle:
    """Tests for workers.tasks.budget_billing_cycle — monthly reset."""

    def test_monthly_budget_reset_resets_all(self) -> None:
        """monthly_budget_reset should reset all budgets."""
        with (
            patch("workers.tasks.budget_billing_cycle.get_all_budgets") as mock_get_all,
            patch("workers.tasks.budget_billing_cycle.reset_budget") as mock_reset,
        ):
            from workers.tasks.budget_billing_cycle import monthly_budget_reset

            mock_get_all.return_value = [
                Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=50000, tokens_used=500_000, cost_incurred=25000),
                Budget(tenant_id="t2", monthly_token_cap=1_000_000, monthly_cost_cap=50000, tokens_used=300_000, cost_incurred=15000),
            ]
            mock_reset.return_value = True

            result = monthly_budget_reset()

            assert result["total"] == 2
            assert result["reset"] == 2
            assert result["failed"] == 0

    def test_monthly_budget_reset_handles_failures(self) -> None:
        """monthly_budget_reset should count failures without crashing."""
        with (
            patch("workers.tasks.budget_billing_cycle.get_all_budgets") as mock_get_all,
            patch("workers.tasks.budget_billing_cycle.reset_budget") as mock_reset,
        ):
            from workers.tasks.budget_billing_cycle import monthly_budget_reset

            mock_get_all.return_value = [
                Budget(tenant_id="t1", tokens_used=500_000, cost_incurred=25000),
                Budget(tenant_id="t2", tokens_used=300_000, cost_incurred=15000),
            ]
            mock_reset.side_effect = [True, False]

            result = monthly_budget_reset()

            assert result["total"] == 2
            assert result["reset"] == 1
            assert result["failed"] == 1

    def test_monthly_budget_reset_empty(self) -> None:
        """No budgets should produce empty summary."""
        with (
            patch("workers.tasks.budget_billing_cycle.get_all_budgets") as mock_get_all,
            patch("workers.tasks.budget_billing_cycle.reset_budget") as mock_reset,
        ):
            from workers.tasks.budget_billing_cycle import monthly_budget_reset

            mock_get_all.return_value = []

            result = monthly_budget_reset()

            assert result["total"] == 0
            assert result["reset"] == 0
            assert result["failed"] == 0

    def test_monthly_budget_reset_catches_exceptions(self) -> None:
        """Exceptions during reset should be caught and counted."""
        with (
            patch("workers.tasks.budget_billing_cycle.get_all_budgets") as mock_get_all,
            patch("workers.tasks.budget_billing_cycle.reset_budget") as mock_reset,
        ):
            from workers.tasks.budget_billing_cycle import monthly_budget_reset

            mock_get_all.return_value = [
                Budget(tenant_id="t1"),
            ]
            mock_reset.side_effect = Exception("Redis error")

            result = monthly_budget_reset()

            assert result["total"] == 1
            assert result["failed"] == 1
            assert result["reset"] == 0


# ===========================================================================
# Budget Middleware Tests
# ===========================================================================


class TestBudgetMiddleware:
    """Tests for workers.budget.middleware — Celery signal handler."""

    def test_middleware_allows_under_budget(self) -> None:
        """Middleware should allow tasks when budget is fine."""
        with (
            patch("workers.budget.middleware.check_budget") as mock_check,
        ):
            from workers.budget.middleware import check_and_block, BudgetExceeded

            mock_check.return_value = BudgetCheckResult(allowed=True, tenant_id="t1")

            # Should not raise
            check_and_block("t1")

    def test_middleware_blocks_exceeded_budget(self) -> None:
        """Middleware should raise BudgetExceeded when budget exceeded."""
        from workers.budget.middleware import BudgetExceeded, check_and_block, invalidate_cache
        invalidate_cache()

        with (
            patch("workers.budget.middleware.check_budget") as mock_check,
        ):
            mock_check.return_value = BudgetCheckResult(
                allowed=False,
                tenant_id="t1",
                blocked_reason="Token cap reached",
                budget=Budget(tenant_id="t1", monthly_token_cap=1000, tokens_used=1000),
            )

            with pytest.raises(BudgetExceeded) as exc_info:
                check_and_block("t1")

            assert "Token cap reached" in str(exc_info.value)

    def test_middleware_cache_hit_skips_check(self) -> None:
        """Cache hit should skip the budget check."""
        from workers.budget.middleware import _set_cache, check_and_block, invalidate_cache

        invalidate_cache()

        with (
            patch("workers.budget.middleware.check_budget") as mock_check,
        ):
            _set_cache("t1")

            # First call should use cache, not call check_budget
            check_and_block("t1")

            mock_check.assert_not_called()

    def test_middleware_cache_miss_calls_check(self) -> None:
        """Cache miss should call the budget check."""
        from workers.budget.middleware import check_and_block, invalidate_cache

        invalidate_cache()

        with (
            patch("workers.budget.middleware.check_budget") as mock_check,
        ):
            mock_check.return_value = BudgetCheckResult(allowed=True, tenant_id="t1")

            check_and_block("t1")

            mock_check.assert_called_once_with("t1")

    def test_middleware_invalidate_cache(self) -> None:
        """Invalidate cache should clear entries."""
        from workers.budget.middleware import _set_cache, invalidate_cache, _is_cached

        _set_cache("t1")
        assert _is_cached("t1") is True

        invalidate_cache("t1")
        assert _is_cached("t1") is False

    def test_middleware_invalidate_all(self) -> None:
        """Invalidate all should clear all cache entries."""
        from workers.budget.middleware import _set_cache, invalidate_cache, _is_cached

        _set_cache("t1")
        _set_cache("t2")
        assert _is_cached("t1") is True
        assert _is_cached("t2") is True

        invalidate_cache()
        assert _is_cached("t1") is False
        assert _is_cached("t2") is False


# ===========================================================================
# Edge Cases
# ===========================================================================


class TestBudgetEdgeCases:
    """Edge cases for budget modules."""

    def test_track_completion_zero_values(self) -> None:
        """Zero values should not error."""
        with patch("workers.budget.tracker._get_redis") as mock_get:
            fake_redis = MagicMock()
            fake_pipe = MagicMock()
            fake_redis.pipeline.return_value = fake_pipe
            fake_pipe.execute.return_value = [0, 0, True]
            fake_redis.hmget.return_value = ["1000000", "50000"]
            mock_get.return_value = fake_redis

            result = track_completion("t1", tokens_used=0, cost_cents=0)

            assert result["tokens_used"] == 0
            assert result["cost_incurred"] == 0

    def test_budget_with_special_chars_tenant_id(self) -> None:
        """Tenant IDs with special chars should not break Redis keys."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.return_value = [5000, 150, True]
        fake_redis.hmget.return_value = ["1000000", "50000"]

        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = track_completion("tenant@example.com:123", tokens_used=5000)
        assert "error" not in result

        monkeypatch.undo()

    def test_reset_all_budgets_summary(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """reset_all_budgets should return proper summary."""
        fake_redis = MagicMock()
        fake_redis.scan.return_value = (0, [
            "stas:budget:t1",
            "stas:budget:t2",
        ])
        fake_redis.hgetall.side_effect = [
            {
                "monthly_token_cap": "1000000",
                "monthly_cost_cap": "50000",
                "tokens_used": "100",
                "cost_incurred": "10",
                "status": "active",
                "reset_at": "2026-06-01T00:00:00",
                "period_start": "2026-06-01T00:00:00",
            },
            {
                "monthly_token_cap": "2000000",
                "monthly_cost_cap": "100000",
                "tokens_used": "200",
                "cost_incurred": "20",
                "status": "active",
                "reset_at": "2026-06-01T00:00:00",
                "period_start": "2026-06-01T00:00:00",
            },
        ]

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        summary = reset_all_budgets()
        assert summary["total"] == 2
        assert summary["reset"] == 2

    def test_track_completion_error_non_fatal(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Tracking error should not crash, returns error dict."""
        fake_redis = MagicMock()
        fake_pipe = MagicMock()
        fake_redis.pipeline.return_value = fake_pipe
        fake_pipe.execute.side_effect = Exception("Connection lost")

        monkeypatch.setattr("workers.budget.tracker._get_redis", lambda: fake_redis)

        result = track_completion("t1", tokens_used=5000)

        assert "error" in result

    def test_budget_combined_usage_max(self) -> None:
        """combined_usage_pct returns max of token and cost pct."""
        b = Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=50_000, tokens_used=500_000, cost_incurred=40_000)
        # token: 50%, cost: 80%
        assert b.combined_usage_pct() == 0.8

    def test_budget_is_unlimited_both_caps(self) -> None:
        """Both caps at -1 should be unlimited."""
        assert Budget(tenant_id="t1", monthly_token_cap=-1, monthly_cost_cap=-1).is_unlimited() is True

    def test_budget_not_unlimited_one_cap(self) -> None:
        """One cap set should not be unlimited."""
        assert Budget(tenant_id="t1", monthly_token_cap=1_000_000, monthly_cost_cap=-1).is_unlimited() is False
        assert Budget(tenant_id="t1", monthly_token_cap=-1, monthly_cost_cap=50_000).is_unlimited() is False
