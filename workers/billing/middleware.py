"""
Tier enforcement middleware -- Celery pre-dispatch gate for plan limits (AIM-2077).

Connects to Celery's ``task_prerun`` signal and checks the tenant's tier usage
before the task executes. If the tenant has hit their tier's usage wall:

1. The task is rejected with a ``TierLimitExceeded`` exception (which Celery
   captures and logs but does NOT retry -- the task is permanently blocked).
2. The rejection is logged with tenant_id, tier, and usage details.

-- Which tasks are gated --------------------------------------------------------
Only tasks whose kwargs contain ``tenant_id`` or ``tenantId`` are checked.
Tasks without a tenant identifier pass through untouched (this avoids blocking
infrastructure tasks like heartbeat, metrics, or maintenance).

-- Caching ----------------------------------------------------------------------
Once a tenant is verified as under the limit, a positive cache entry is set
for ``TIER_CACHE_TTL`` seconds (default 60) to avoid hitting Redis on every
task dispatch. Cache is invalidated when usage is incremented.

-- Error Handling ----------------------------------------------------------------
- Redis failures: allow the task through (fail-open with warning).
- Unknown tenant IDs: treat as "free" tier with 0 usage (allow through).
- The middleware never crashes the worker -- exceptions are caught and logged.
----------------------------------------------------------------------------------
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from celery import Task, signals

from workers.billing.tiers import get_tier_usage, resolve_tier, tier_max_fixes, tier_wall_at
from workers.billing.pql import check_wall

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_cache: dict[str, float] = {}  # tenant_id -> expiry timestamp
_CACHE_TTL = int(os.getenv("TIER_CACHE_TTL_SECONDS", "60"))
_MAX_CACHE_SIZE = 10_000


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class TierLimitExceeded(Exception):
    """Raised when a tenant has exceeded their tier's fix limit."""

    def __init__(self, tenant_id: str, tier: str, usage: int, limit: int, reason: str) -> None:
        self.tenant_id = tenant_id
        self.tier = tier
        self.usage = usage
        self.limit = limit
        self.reason = reason
        super().__init__(f"Tenant {tenant_id!r} ({tier}) has exceeded the fix limit: {reason}")


# ---------------------------------------------------------------------------
# Core check
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
    """Invalidate the tier cache for a tenant or all tenants."""
    if tenant_id is not None:
        _cache.pop(tenant_id, None)
    else:
        _cache.clear()


def check_and_block(tenant_id: str) -> None:
    """Check whether a tenant can dispatch a task based on tier usage.

    Raises ``TierLimitExceeded`` if the tenant has hit their tier wall.
    Otherwise returns None (task can proceed).

    Parameters
    ----------
    tenant_id : str
        The tenant identifier to check.

    Raises
    ------
    TierLimitExceeded
        If the tenant has exceeded their tier's fix limit.
    """
    # Cache hit -- allow through
    if _is_cached(tenant_id):
        return

    tier = resolve_tier(tenant_id)
    limit = tier_max_fixes(tier)

    # Unlimited tiers: cache and allow
    if limit < 0:
        _set_cache(tenant_id)
        return

    # Read usage
    try:
        usage_data = get_tier_usage(tenant_id)
        usage = usage_data.get("usage", 0)
    except Exception as exc:
        logger.warning(
            "Tier check failed for tenant=%s -- allowing through: %s",
            tenant_id,
            exc,
        )
        return

    # Check wall
    wall_at = tier_wall_at(tier)
    if wall_at is not None and usage >= wall_at:
        wall_result = check_wall(tenant_id)
        reason = wall_result.reason or f"Usage {usage} >= limit {limit}"
        logger.warning(
            "Tier limit blocked tenant=%s tier=%s usage=%d limit=%d",
            tenant_id,
            tier,
            usage,
            limit,
        )
        raise TierLimitExceeded(
            tenant_id=tenant_id,
            tier=tier,
            usage=usage,
            limit=limit,
            reason=reason,
        )

    # Under limit -- cache and allow
    _set_cache(tenant_id)


# ---------------------------------------------------------------------------
# Celery signal handler
# ---------------------------------------------------------------------------


@signals.task_prerun.connect
def _on_task_prerun(task_id: str, task: Task, **kwargs: Any) -> None:
    """Celery ``task_prerun`` handler -- gate task dispatch against tier limits.

    Extracts the ``tenant_id`` (or ``tenantId``) from the task's kwargs and
    runs the tier check. If the tenant has hit their limit, the task is
    rejected with ``TierLimitExceeded``.
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
    except TierLimitExceeded:
        raise
    except Exception as exc:
        logger.error(
            "Unexpected error in tier middleware for tenant=%s task=%s task_id=%s -- %s",
            tenant_id,
            getattr(task, "name", "unknown"),
            task_id,
            exc,
        )
        # Fail-open: allow the task through if the middleware itself crashes


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------


def connect_tier_middleware() -> None:
    """Connect the tier enforcement middleware.

    Call this during Celery app initialization (typically from ``celery_app.py``).
    The signal handler is registered via the ``@signals.task_prerun.connect``
    decorator, so calling this function is technically optional (the decorator
    fires at import time). However, calling it explicitly ensures the middleware
    is connected even if the module is imported but the signal registration
    fails silently.
    """
    logger.info("Tier enforcement middleware connected -- task dispatch gated by plan limits")
