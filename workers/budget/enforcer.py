from __future__ import annotations

import logging
from typing import Any

from workers.budget.models import BudgetStatus
from workers.budget.tracker import BudgetTracker

logger = logging.getLogger(__name__)


class BudgetEnforcer:
    def __init__(self, tracker: BudgetTracker | None = None) -> None:
        self._tracker = tracker or BudgetTracker()

    def check_budget(self, tenant_id: str) -> dict[str, Any]:
        budget = self._tracker.get_or_create_budget(tenant_id)

        if budget.is_unlimited():
            return {
                "allowed": True,
                "status": BudgetStatus.DISABLED.value,
                "reason": "unlimited",
                "usage_ratio": 0.0,
            }

        usage_ratio = budget.usage_ratio()

        if usage_ratio >= 1.0:
            return {
                "allowed": False,
                "status": BudgetStatus.EXCEEDED.value,
                "reason": "budget_exceeded",
                "usage_ratio": usage_ratio,
                "tokens_used": budget.tokens_used,
                "cost_incurred": budget.cost_incurred,
                "monthly_token_cap": budget.monthly_token_cap,
                "monthly_cost_cap": budget.monthly_cost_cap,
            }

        if usage_ratio >= 0.8:
            logger.warning(
                "Budget warning for %s: %.1f%% used (tokens=%d, cost=%.2f)",
                tenant_id,
                usage_ratio * 100,
                budget.tokens_used,
                budget.cost_incurred,
            )
            return {
                "allowed": True,
                "status": BudgetStatus.WARNING.value,
                "reason": "budget_warning",
                "usage_ratio": usage_ratio,
            }

        return {
            "allowed": True,
            "status": BudgetStatus.ACTIVE.value,
            "reason": "within_budget",
            "usage_ratio": usage_ratio,
        }

    def enforce_pre_dispatch(self, tenant_id: str) -> dict[str, Any]:
        result = self.check_budget(tenant_id)
        if not result["allowed"]:
            logger.warning(
                "Budget exceeded for %s — blocking dispatch. ratio=%.2f tokens=%d",
                tenant_id,
                result.get("usage_ratio", 0),
                result.get("tokens_used", 0),
            )
        return result
