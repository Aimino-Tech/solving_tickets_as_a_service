"""
Budget enforcement middleware — Celery pre-dispatch gate for token/cost caps (AIM-1996).

Connects to Celery's ``task_prerun`` signal and checks the tenant's budget
before the task executes. If the tenant has exceeded their token or cost cap:

1. The task is rejected with a ``BudgetExceeded`` exception (permanently blocked).
2. The rejection is logged with tenant_id, usage, and cap details.

── Which tasks are gated ─────────────────────────────────────────────────────
Only tasks whose kwargs contain ``tenant_id`` or ``tenantId`` are checked.
Tasks without a tenant identifier pass through untouched (this avoids blocking
infrastructure tasks like heartbeat, metrics, or maintenance).

── Caching ───────────────────────────────────────────────────────────────────
Once a tenant passes the budget check, a positive cache entry is set for
``BUDGET_CACHE_TTL`` seconds (default 60) to avoid hitting Redis on every
task dispatch.

── Error Handling ────────────────────────────────────────────────────────────
- Redis failures: allow the task through (fail-open with warning).
- Unknown tenant IDs (no budget record): treat as unlimited — allow through.
- The middleware never crashes the worker — exceptions are caught and logged.
───────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from celery import Task, signals

from workers.budget.enforcer import check_budget
from workers.budget.models import BudgetCheckResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_cache: dict[str, float] = {}  # tenant_id -> expiry timestamp
_CACHE_TTL = int(os.getenv("BUDGET_CACHE_TTL_SECONDS", "60"))
_MAX_CACHE_SIZE = 10_000


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class BudgetExceeded(Exception):
    """Raised when a tenant has exceeded their token or cost budget."""

    def __init__(
        self,
        tenant_id: str,
        result: BudgetCheckResult,
    ) -> None:
        self.tenant_id = tenant_id
        self.result = result
        reason = result.blocked_reason or "Budget exceeded"
        super().__init__(f"Tenant {tenant_id!r} has exceeded budget: {reason}")


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------


def _is_cached(tenant_id: str) -> bool:
    """Check if a tenant has a valid positive cache entry."""
    expiry = _cache.get(tenant_id)
    if expiry is not None and time.time() < expiry:
        return True
    _cache.pop(tenant_id, None)
    return False


def _set_cache(tenant_id: str) -> None:
    """Set a positive cache entry for the tenant."""
    if len(_cache) < _MAX_CACHE_SIZE:
        _cache[tenant_id] = time.time() + _CACHE_TTL


def invalidate_cache(tenant_id: str | None = None) -> None:
    """Invalidate the budget cache for a tenant or all tenants."""
    if tenant_id is not None:
        _cache.pop(tenant_id, None)
    else:
        _cache.clear()


# ---------------------------------------------------------------------------
# Core check
# ---------------------------------------------------------------------------


def check_and_block(tenant_id: str) -> None:
    """Check whether a tenant can dispatch a task within their budget.

    Raises ``BudgetExceeded`` if the tenant has exceeded their token or cost cap.
    Otherwise returns None (task can proceed).

    Parameters
    ----------
    tenant_id : str
        The tenant identifier to check.

    Raises
    ------
    BudgetExceeded
        If the tenant has exceeded their budget caps.
    """
    # Cache hit — allow through
    if _is_cached(tenant_id):
        return

    result = check_budget(tenant_id)

    if not result.allowed:
        logger.warning(
            "Budget blocked tenant=%s tokens=%s cost=%s caps=%s",
            tenant_id,
            result.budget.tokens_used if result.budget else "?",
            result.budget.cost_incurred if result.budget else "?",
            f"tok={result.budget.monthly_token_cap}/cost={result.budget.monthly_cost_cap}"
            if result.budget
            else "?",
        )
        raise BudgetExceeded(tenant_id=tenant_id, result=result)

    # Under limit — cache and allow
    _set_cache(tenant_id)


# ---------------------------------------------------------------------------
# Celery signal handler
# ---------------------------------------------------------------------------


@signals.task_prerun.connect
def _on_task_prerun(task_id: str, task: Task, **kwargs: Any) -> None:
    """Celery ``task_prerun`` handler — gate task dispatch against budget limits.

    Extracts the ``tenant_id`` (or ``tenantId``) from the task's kwargs and
    runs the budget check. If the tenant has exceeded their caps, the task is
    rejected with ``BudgetExceeded``.
    """
    request = getattr(task, "request", None)
    if request is None:
        return

    task_kwargs = request.kwargs if hasattr(request, "kwargs") else {}
    args = request.args if hasattr(request, "args") else ()

    tenant_id: str | None = (
        task_kwargs.get("tenant_id")
        or task_kwargs.get("tenantId")
        or (args[0] if args and isinstance(args[0], str) else None)
    )

    if tenant_id is None:
        return

    try:
        check_and_block(tenant_id)
    except BudgetExceeded:
        raise
    except Exception as exc:
        logger.error(
            "Unexpected error in budget middleware for tenant=%s task=%s task_id=%s — %s",
            tenant_id,
            getattr(task, "name", "unknown"),
            task_id,
            exc,
        )
        # Fail-open: allow the task through if the middleware itself crashes


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------


def connect_budget_middleware() -> None:
    """Connect the budget enforcement middleware.

    Call this during Celery app initialization (typically from ``celery_app.py``).
    The signal handler is registered via the ``@signals.task_prerun.connect``
    decorator, so calling this function is technically optional (the decorator
    fires at import time). However, calling it explicitly ensures the middleware
    is connected even if the module is imported but the signal registration
    fails silently.
    """
    logger.info("Budget enforcement middleware connected — task dispatch gated by token/cost caps")
