"""
Cost Budget & Usage Tracking — per-tenant token/cost caps (AIM-1996).

Provides per-tenant monthly budget enforcement: token caps and cost caps
that are checked before dispatch and tracked atomically in Redis.

Modules
-------
    models
        Budget dataclass, BudgetStatus enum, BudgetCheckResult — the
        canonical data types for the budget system.
    tracker
        Redis-backed atomic counters — track_completion, get_budget,
        reset_budget, get_all_budgets.
    enforcer
        Pre-dispatch budget check — returns BudgetCheckResult with
        allowed/blocked/warning status.
"""

from workers.budget.models import (
    Budget,
    BudgetStatus,
    BudgetCheckResult,
)
from workers.budget.tracker import (
    init_budget,
    track_completion,
    get_budget,
    get_all_budgets,
    reset_budget,
    reset_all_budgets,
)
from workers.budget.enforcer import (
    check_budget,
)
from workers.budget.middleware import (
    BudgetExceeded,
    check_and_block as middleware_check_and_block,
    connect_budget_middleware,
    invalidate_cache as middleware_invalidate_cache,
)

__all__ = [
    "Budget",
    "BudgetStatus",
    "BudgetCheckResult",
    "BudgetExceeded",
    "init_budget",
    "track_completion",
    "get_budget",
    "get_all_budgets",
    "reset_budget",
    "reset_all_budgets",
    "check_budget",
    "connect_budget_middleware",
]
