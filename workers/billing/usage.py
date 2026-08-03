"""
Usage counter service — Redis atomic increment counters per tenant.

Provides atomic usage tracking for billing metering. Each fix run increments
a per-tenant counter in Redis. A Celery beat task syncs daily counts to Stripe
for invoicing. A query API allows the Express service to check usage before
dispatching a fix run.

── Key Design ────────────────────────────────────────────────────────────────
- Redis HASH per tenant: ``syntaro:billing:usage:{tenant_id}``
    field  ``count``       → atomic integer, incremented per fix run
    field  ``period_start`` → ISO timestamp of current billing period
- A daily Celery beat task reads all tenant counters and reports them to
  Stripe via ``stripe.billing.meter_events.create()``, then resets the local
  counter for the new period.
- For the self-hosted (OSS) path, counters accumulate until manually reset
  or the period turns over in the database billing record.

── Error Handling ───────────────────────────────────────────────────────────
- Redis connection failures are logged and return safe defaults (0 usage).
- Stripe sync failures are logged but never crash the worker — the counter
  remains intact for the next sync attempt.
- Missing tenant IDs default to "free" tier with no metering.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

from celery import shared_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis client (lazy singleton)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None
_REDIS_URL = os.getenv(
    "REDIS_URL",
    os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
)

_USAGE_KEY_PREFIX = "syntaro:billing:usage:"
_USAGE_COUNT_FIELD = "count"
_USAGE_PERIOD_FIELD = "period_start"

# Stripe meter event API version
_STRIPE_METER_API_VERSION = os.getenv("STRIPE_METER_API_VERSION", "2025-02-24.acacia")


def _get_redis() -> Any:
    """Get-or-create the shared Redis client for usage tracking."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        _REDIS_CLIENT = _redis_mod.from_url(_REDIS_URL, decode_responses=True)
        _REDIS_CLIENT.ping()
        logger.info("Usage counter Redis connected — url=%s", _REDIS_URL)
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Usage counter Redis unavailable — %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------


def _usage_key(tenant_id: str) -> str:
    return f"{_USAGE_KEY_PREFIX}{tenant_id}"


# ---------------------------------------------------------------------------
# Atomic usage counter
# ---------------------------------------------------------------------------


def increment_usage(tenant_id: str, period_start: str | None = None) -> int:
    """
    Atomically increment the usage counter for a tenant.

    If the key does not exist, it is created with ``count=1`` and
    ``period_start`` set to the provided ISO timestamp (or current UTC time).

    Returns the new count value.
    """
    client = _get_redis()
    if not client:
        logger.warning("Redis unavailable — usage increment skipped for tenant=%s", tenant_id)
        return 0

    try:
        key = _usage_key(tenant_id)
        pipe = client.pipeline()
        pipe.hincrby(key, _USAGE_COUNT_FIELD, 1)
        # Set period_start only if not already set (first increment of period)
        pipe.hsetnx(key, _USAGE_PERIOD_FIELD, period_start or _now_iso())
        # TTL: 62 days to survive billing cycles
        pipe.expire(key, 62 * 24 * 60 * 60)
        results = pipe.execute()
        new_count = results[0]
        logger.debug(
            "Usage incremented tenant=%s count=%d",
            tenant_id,
            new_count,
        )
        return new_count
    except Exception as exc:
        logger.error(
            "Failed to increment usage tenant=%s — %s",
            tenant_id,
            exc,
        )
        return 0


def get_usage(tenant_id: str) -> dict[str, Any]:
    """
    Get the current usage counter and period start for a tenant.

    Returns::

        {
            "tenant_id": str,
            "count": int,
            "period_start": str | None,
        }

    If the tenant has no usage record, ``count`` is 0 and ``period_start`` is None.
    """
    client = _get_redis()
    if not client:
        return {"tenant_id": tenant_id, "count": 0, "period_start": None}

    try:
        key = _usage_key(tenant_id)
        data = client.hgetall(key)
        count = int(data.get(_USAGE_COUNT_FIELD, 0))
        period_start = data.get(_USAGE_PERIOD_FIELD)
        return {
            "tenant_id": tenant_id,
            "count": count,
            "period_start": period_start,
        }
    except Exception as exc:
        logger.error("Failed to get usage tenant=%s — %s", tenant_id, exc)
        return {"tenant_id": tenant_id, "count": 0, "period_start": None}


def reset_usage(tenant_id: str) -> None:
    """Reset the usage counter for a tenant (start of new billing period)."""
    client = _get_redis()
    if not client:
        return
    try:
        key = _usage_key(tenant_id)
        client.delete(key)
        logger.info("Usage reset tenant=%s", tenant_id)
    except Exception as exc:
        logger.error("Failed to reset usage tenant=%s — %s", tenant_id, exc)


def get_all_usage() -> list[dict[str, Any]]:
    """
    Iterate all tenant usage counters in Redis.

    Uses Redis SCAN to avoid blocking on large key spaces.

    Returns a list of usage dicts (same shape as ``get_usage()``).
    """
    client = _get_redis()
    if not client:
        return []

    results: list[dict[str, Any]] = []
    cursor = 0
    try:
        while True:
            cursor, keys = client.scan(cursor, match=f"{_USAGE_KEY_PREFIX}*", count=100)
            for key in keys:
                tenant_id = key[len(_USAGE_KEY_PREFIX):]
                results.append(get_usage(tenant_id))
            if cursor == 0:
                break
    except Exception as exc:
        logger.error("Failed to scan all usage keys — %s", exc)

    return results


# ---------------------------------------------------------------------------
# Stripe Meter Event sync
# ---------------------------------------------------------------------------


def _get_stripe_api_key() -> str:
    key = os.getenv("STRIPE_SECRET_KEY", "")
    if not key:
        logger.warning("STRIPE_SECRET_KEY not set — Stripe meter event sync disabled")
    return key


def _report_usage_to_stripe(tenant_id: str, count: int) -> bool:
    """
    Report accumulated usage to Stripe via ``billing.meter_events.create()``.

    This sends a single meter event with the tenant's identifier and the
    total count since the last sync. Stripe uses this for usage-based billing.

    Returns True if the event was reported successfully, False otherwise.
    """
    api_key = _get_stripe_api_key()
    if not api_key:
        return False

    try:
        import stripe as stripe_mod

        stripe_mod.api_key = api_key
        stripe_mod.api_version = _STRIPE_METER_API_VERSION

        # Stripe meter events require a meter event name configured in the
        # Stripe dashboard. The default is "syntaro_fix_run".
        meter_event_name = os.getenv("STRIPE_METER_EVENT_NAME", "syntaro_fix_run")

        stripe_mod.billing.MeterEvent.create(
            event_name=meter_event_name,
            payload={
                "stripe_customer_id": tenant_id,
                "value": str(count),
            },
            timestamp=int(time.time()),
        )
        logger.info(
            "Reported usage to Stripe tenant=%s count=%d meter_event=%s",
            tenant_id,
            count,
            meter_event_name,
        )
        return True
    except Exception as exc:
        logger.error(
            "Failed to report usage to Stripe tenant=%s count=%d — %s",
            tenant_id,
            count,
            exc,
        )
        return False


# ---------------------------------------------------------------------------
# Celery Beat task: daily sync to Stripe
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    autoretry_for=(Exception,),
    name="workers.billing.usage.sync_usage_to_stripe",
)
def sync_usage_to_stripe(self) -> dict[str, Any]:
    """
    Celery Beat periodic task — sync all tenant usage counters to Stripe.

    Reads every tenant's accumulated usage from Redis, reports each to Stripe
    via ``billing.meter_events.create()``, then resets the local counters.

    Scheduled via celeryconfig.py beat_schedule (default: daily at 01:00 UTC).

    Returns a summary dict with counts of synced, failed, and skipped tenants.
    """
    logger.info("Starting daily usage-to-Stripe sync")

    all_usage = get_all_usage()
    synced = 0
    failed = 0
    skipped = 0
    errors: list[str] = []

    for record in all_usage:
        tenant_id = record["tenant_id"]
        count = record["count"]

        if count <= 0:
            skipped += 1
            continue

        ok = _report_usage_to_stripe(tenant_id, count)
        if ok:
            reset_usage(tenant_id)
            synced += 1
        else:
            failed += 1
            errors.append(tenant_id)

    summary = {
        "total_tenants": len(all_usage),
        "synced": synced,
        "failed": failed,
        "skipped": skipped,
        "errors": errors[:10],  # cap error list
        "timestamp": _now_iso(),
    }

    level = logger.error if failed > 0 else logger.info
    level("Usage sync complete — %s", json.dumps(summary))

    return summary


# ---------------------------------------------------------------------------
# Usage query API (called from Express via HTTP)
# ---------------------------------------------------------------------------


def get_usage_summary(tenant_id: str) -> dict[str, Any]:
    """
    Get a full usage summary for a tenant.

    Returns:

        {
            "tenant_id": str,
            "count": int,
            "period_start": str | None,
            "remaining": int,          # based on tier max or -1 for unlimited
            "tier": str,
        }

    The ``remaining`` field is computed by subtracting ``count`` from the
    tier's max_issues limit. If the tier is unknown or unlimited, remaining
    is ``-1``.
    """
    usage = get_usage(tenant_id)
    tier = _resolve_tier(tenant_id)
    max_issues = _tier_max_issues(tier)

    if max_issues < 0:
        usage["remaining"] = -1
    else:
        usage["remaining"] = max(0, max_issues - usage["count"])

    usage["tier"] = tier
    return usage


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_TIER_MAX_ISSUES: dict[str, int] = {
    "free": int(os.getenv("TIER_FREE_MAX_ISSUES", "10")),
    "pro": int(os.getenv("TIER_PRO_MAX_ISSUES", "100")),
    "team": int(os.getenv("TIER_TEAM_MAX_ISSUES", "500")),
    "enterprise": int(os.getenv("TIER_ENTERPRISE_MAX_ISSUES", "-1")),  # -1 = unlimited
}

_TIER_NAMES = frozenset(_TIER_MAX_ISSUES)


def _resolve_tier(tenant_id: str) -> str:
    """Resolve a tenant's tier from environment or return default."""
    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    tier = os.getenv(env_var, "free").lower()
    if tier in _TIER_NAMES:
        return tier
    return "free"


def _tier_max_issues(tier: str) -> int:
    val = _TIER_MAX_ISSUES.get(tier, 10)
    if val < 0:
        return -1  # unlimited
    return val


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
