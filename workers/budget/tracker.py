"""
Redis-backed atomic budget tracking for per-tenant token/cost budgets.

Provides atomic operations to initialise, track, query, and reset per-tenant
budgets stored in Redis hashes.

── Key Design ────────────────────────────────────────────────────────────────
- Redis HASH per tenant: ``stas:budget:{tenant_id}``
    field  ``monthly_token_cap``  → int (-1 = unlimited)
    field  ``monthly_cost_cap``   → int in cents (-1 = unlimited)
    field  ``tokens_used``        → int, atomic HINCRBY
    field  ``cost_incurred``      → int in cents, atomic HINCRBY
    field  ``status``             → BudgetStatus value string
    field  ``reset_at``           → ISO-8601 timestamp of last reset
    field  ``period_start``       → ISO-8601 timestamp of current period start
- All counter updates are atomic via Redis pipelines.
- Redis connection failures return safe defaults and log warnings.
───────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

from workers.budget.models import Budget, BudgetStatus, _now_iso

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis client (lazy singleton)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None
_REDIS_URL = os.getenv(
    "REDIS_URL",
    os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
)

_BUDGET_KEY_PREFIX = "stas:budget:"
_BUDGET_TTL_DAYS = 93  # ~3 months to survive multiple billing cycles

# Field names in the Redis hash
_F_MONTHLY_TOKEN_CAP = "monthly_token_cap"
_F_MONTHLY_COST_CAP = "monthly_cost_cap"
_F_TOKENS_USED = "tokens_used"
_F_COST_INCURRED = "cost_incurred"
_F_STATUS = "status"
_F_RESET_AT = "reset_at"
_F_PERIOD_START = "period_start"


def _get_redis() -> Any:
    """Get-or-create the shared Redis client for budget tracking."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        _REDIS_CLIENT = _redis_mod.from_url(_REDIS_URL, decode_responses=True)
        _REDIS_CLIENT.ping()
        logger.info("Budget tracker Redis connected — url=%s", _REDIS_URL)
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Budget tracker Redis unavailable — %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------


def _budget_key(tenant_id: str) -> str:
    """Return the Redis key for a tenant's budget hash."""
    return f"{_BUDGET_KEY_PREFIX}{tenant_id}"


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------


def init_budget(
    tenant_id: str,
    monthly_token_cap: int = -1,
    monthly_cost_cap: int = -1,
) -> bool:
    """
    Initialise a budget record for a tenant.

    If the key already exists, this is a no-op (use ``reset_budget`` to
    overwrite). Caps of -1 mean unlimited.

    Returns True if the record was created, False if it already existed
    or Redis was unavailable.
    """
    client = _get_redis()
    if not client:
        logger.warning("Redis unavailable — budget init skipped for tenant=%s", tenant_id)
        return False

    try:
        key = _budget_key(tenant_id)
        now = _now_iso()
        pipe = client.pipeline()
        pipe.hsetnx(key, _F_MONTHLY_TOKEN_CAP, monthly_token_cap)
        pipe.hsetnx(key, _F_MONTHLY_COST_CAP, monthly_cost_cap)
        pipe.hsetnx(key, _F_TOKENS_USED, 0)
        pipe.hsetnx(key, _F_COST_INCURRED, 0)
        pipe.hsetnx(key, _F_STATUS, BudgetStatus.ACTIVE.value)
        pipe.hsetnx(key, _F_RESET_AT, now)
        pipe.hsetnx(key, _F_PERIOD_START, now)
        pipe.expire(key, _BUDGET_TTL_DAYS * 24 * 60 * 60)
        results = pipe.execute()

        # hsetnx returns 1 if the field was set, 0 if it already existed.
        created = results[0] == 1
        if created:
            logger.info(
                "Budget initialised tenant=%s token_cap=%d cost_cap=%d",
                tenant_id,
                monthly_token_cap,
                monthly_cost_cap,
            )
        else:
            logger.debug("Budget already exists tenant=%s — no-op", tenant_id)

        return created
    except Exception as exc:
        logger.error("Failed to init budget tenant=%s — %s", tenant_id, exc)
        return False


# ---------------------------------------------------------------------------
# Tracking (atomic counters)
# ---------------------------------------------------------------------------


def track_completion(
    tenant_id: str,
    tokens_used: int = 0,
    cost_cents: int = 0,
) -> dict[str, Any]:
    """
    Atomically update a tenant's budget counters after a task completes.

    Increments ``tokens_used`` by ``tokens_used`` and ``cost_incurred`` by
    ``cost_cents``. Re-computes the budget status (ACTIVE / WARNING / EXCEEDED)
    based on the new totals.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.
    tokens_used : int
        Number of tokens consumed by this task.
    cost_cents : int
        Cost in cents incurred by this task.

    Returns
    -------
    dict
        The updated budget state as a dict (same shape as ``get_budget``),
        or a dict with ``error`` if Redis is unavailable.
    """
    client = _get_redis()
    if not client:
        logger.warning("Redis unavailable — budget tracking skipped tenant=%s", tenant_id)
        return {"tenant_id": tenant_id, "error": "Redis unavailable"}

    try:
        key = _budget_key(tenant_id)
        pipe = client.pipeline()
        pipe.hincrby(key, _F_TOKENS_USED, tokens_used)
        pipe.hincrby(key, _F_COST_INCURRED, cost_cents)
        # Refresh TTL on every write
        pipe.expire(key, _BUDGET_TTL_DAYS * 24 * 60 * 60)
        results = pipe.execute()

        new_tokens = int(results[0])
        new_cost = int(results[1])

        # Read caps to determine new status
        caps = client.hmget(key, _F_MONTHLY_TOKEN_CAP, _F_MONTHLY_COST_CAP)
        token_cap = int(caps[0]) if caps[0] is not None else -1
        cost_cap = int(caps[1]) if caps[1] is not None else -1

        # Compute new status
        new_status = _compute_status(new_tokens, new_cost, token_cap, cost_cap)
        client.hset(key, _F_STATUS, new_status.value)

        logger.debug(
            "Budget updated tenant=%s tokens=%d/%d cost=%d/%d status=%s",
            tenant_id,
            new_tokens,
            token_cap if token_cap >= 0 else "unlimited",
            new_cost,
            cost_cap if cost_cap >= 0 else "unlimited",
            new_status.value,
        )

        return {
            "tenant_id": tenant_id,
            "tokens_used": new_tokens,
            "cost_incurred": new_cost,
            "monthly_token_cap": token_cap,
            "monthly_cost_cap": cost_cap,
            "status": new_status.value,
        }
    except Exception as exc:
        logger.error("Failed to track budget completion tenant=%s — %s", tenant_id, exc)
        return {"tenant_id": tenant_id, "error": str(exc)}


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------


def get_budget(tenant_id: str) -> Budget | None:
    """
    Get the full budget state for a tenant.

    Returns a ``Budget`` instance, or ``None`` if no budget record exists
    or Redis is unavailable.
    """
    client = _get_redis()
    if not client:
        return None

    try:
        key = _budget_key(tenant_id)
        data = client.hgetall(key)
        if not data:
            return None

        data["tenant_id"] = tenant_id
        return Budget.from_dict(data)
    except Exception as exc:
        logger.error("Failed to get budget tenant=%s — %s", tenant_id, exc)
        return None


def get_all_budgets() -> list[Budget]:
    """
    Iterate all tenant budget records in Redis.

    Uses Redis SCAN to avoid blocking on large key spaces. Returns a list
    of ``Budget`` instances.
    """
    client = _get_redis()
    if not client:
        return []

    results: list[Budget] = []
    cursor = 0
    try:
        while True:
            cursor, keys = client.scan(cursor, match=f"{_BUDGET_KEY_PREFIX}*", count=100)
            for key in keys:
                tenant_id = key[len(_BUDGET_KEY_PREFIX):]
                budget = get_budget(tenant_id)
                if budget is not None:
                    results.append(budget)
            if cursor == 0:
                break
    except Exception as exc:
        logger.error("Failed to scan budget keys — %s", exc)

    return results


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------


def reset_budget(tenant_id: str) -> bool:
    """
    Reset a tenant's budget counters for a new billing period.

    Zeros out ``tokens_used`` and ``cost_incurred``, sets status to RESET,
    and updates ``reset_at`` and ``period_start``.

    Returns True on success, False if Redis unavailable or no record exists.
    """
    client = _get_redis()
    if not client:
        return False

    try:
        key = _budget_key(tenant_id)
        now = _now_iso()
        pipe = client.pipeline()
        pipe.hset(key, _F_TOKENS_USED, 0)
        pipe.hset(key, _F_COST_INCURRED, 0)
        pipe.hset(key, _F_STATUS, BudgetStatus.RESET.value)
        pipe.hset(key, _F_RESET_AT, now)
        pipe.hset(key, _F_PERIOD_START, now)
        pipe.expire(key, _BUDGET_TTL_DAYS * 24 * 60 * 60)
        pipe.execute()

        logger.info("Budget reset tenant=%s", tenant_id)
        return True
    except Exception as exc:
        logger.error("Failed to reset budget tenant=%s — %s", tenant_id, exc)
        return False


def reset_all_budgets() -> dict[str, Any]:
    """
    Reset budget counters for all tenants with budget records.

    Returns a summary dict with counts of reset, failed, and total tenants.
    """
    budgets = get_all_budgets()
    total = len(budgets)
    reset_count = 0
    failed = 0

    for budget in budgets:
        ok = reset_budget(budget.tenant_id)
        if ok:
            reset_count += 1
        else:
            failed += 1

    summary = {
        "total": total,
        "reset": reset_count,
        "failed": failed,
        "timestamp": _now_iso(),
    }

    logger.info("Budget reset all complete — %s", json.dumps(summary))
    return summary


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_status(
    tokens_used: int,
    cost_incurred: int,
    token_cap: int,
    cost_cap: int,
    warn_threshold: float = 0.8,
) -> BudgetStatus:
    """
    Compute budget status based on current usage and caps.

    - If either cap is exceeded → EXCEEDED
    - If either cap is at or above warn_threshold → WARNING
    - Otherwise → ACTIVE

    Unlimited caps (-1) are never considered exceeded or warning.
    """
    if token_cap >= 0 and tokens_used >= token_cap:
        return BudgetStatus.EXCEEDED
    if cost_cap >= 0 and cost_incurred >= cost_cap:
        return BudgetStatus.EXCEEDED

    if token_cap >= 0 and tokens_used >= int(token_cap * warn_threshold):
        return BudgetStatus.WARNING
    if cost_cap >= 0 and cost_incurred >= int(cost_cap * warn_threshold):
        return BudgetStatus.WARNING

    return BudgetStatus.ACTIVE
