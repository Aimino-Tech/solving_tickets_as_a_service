from __future__ import annotations

import os
import tempfile

from workers.budget import BudgetTracker, BudgetEnforcer, Budget, BudgetStatus, ModelPricing


class TestModelPricing:
    def test_get_cost_known_model(self) -> None:
        p = ModelPricing()
        cost = p.get_cost("gpt-4", 1000, 500)
        assert cost > 0

    def test_get_cost_unknown_model_defaults(self) -> None:
        p = ModelPricing()
        cost = p.get_cost("unknown-model-v1", 1000, 1000)
        assert cost > 0


class TestBudget:
    def test_unlimited_when_no_caps(self) -> None:
        b = Budget(tenant_id="t1")
        assert b.is_unlimited()

    def test_not_unlimited_with_cap(self) -> None:
        b = Budget(tenant_id="t1", monthly_token_cap=100000)
        assert not b.is_unlimited()

    def test_usage_ratio(self) -> None:
        b = Budget(tenant_id="t1", monthly_token_cap=1000, tokens_used=500)
        assert b.usage_ratio() == 0.5

    def test_should_warn_at_80_percent(self) -> None:
        b = Budget(tenant_id="t1", monthly_token_cap=1000, tokens_used=800)
        assert b.should_warn()

    def test_is_exceeded_at_100_percent(self) -> None:
        b = Budget(tenant_id="t1", monthly_token_cap=1000, tokens_used=1000)
        assert b.is_exceeded()


class TestBudgetTracker:
    def setup_method(self) -> None:
        self.db = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.db_path = self.db.name
        self.db.close()

    def teardown_method(self) -> None:
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_get_or_create_budget(self) -> None:
        tracker = BudgetTracker(db_path=self.db_path)
        budget = tracker.get_or_create_budget("tenant-test-1")
        assert budget.tenant_id == "tenant-test-1"

    def test_track_usage(self) -> None:
        tracker = BudgetTracker(db_path=self.db_path)
        result = tracker.track_usage("tenant-test-2", "task-1", "gpt-4", 1000, 500)
        assert result["total_tokens"] == 1500
        assert result["cost"] > 0

    def test_get_usage(self) -> None:
        tracker = BudgetTracker(db_path=self.db_path)
        tracker.track_usage("tenant-test-3", "task-1", "gpt-3.5-turbo", 500, 200)
        usage = tracker.get_usage("tenant-test-3")
        assert usage["total_runs"] == 1


class TestBudgetEnforcer:
    def test_unlimited_allowed(self) -> None:
        enforcer = BudgetEnforcer()
        result = enforcer.check_budget("unlimited-tenant")
        assert result["allowed"]


class TestBudgetStatus:
    def test_status_values(self) -> None:
        assert BudgetStatus.ACTIVE.value == "active"
        assert BudgetStatus.WARNING.value == "warning"
        assert BudgetStatus.EXCEEDED.value == "exceeded"
