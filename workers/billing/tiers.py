"""
Tier definitions, usage counter, and PQL scoring (AIM-2077).

Provides the canonical tier definitions, atomic usage tracking, and
product-qualified lead (PQL) scoring for the free -> paid conversion funnel.

-- Tier Limits -----------------------------------------------------------------
  free:     10 fixes/mo  -- PQL nudge at fix #8, hard wall at fix #10
  solo:     50 fixes/mo  -- no nudges, no wall
  team:     unlimited    -- no nudges, no wall
  enterprise: unlimited  -- no nudges, no wall

-- PQL Scoring -----------------------------------------------------------------
Each fix run contributes to a tenant's PQL score, which is used to gauge
conversion readiness. Factors:
  - Fixes completed (weight: 1.0 each)
  - Successful verification (weight: 2.0 each)
  - Consecutive days active (weight: 0.5 per day)
  - Repos connected (weight: 1.0 per repo, max 5.0)
  - Webhook configured (weight: 3.0)

A PQL score >= 7.0 is considered "conversion-ready".

-- Error Handling ---------------------------------------------------------------
- Redis connection failures return safe defaults (0 usage, PQL score 0).
- Unknown tenant IDs default to "free" tier.
- All counters are atomic via Redis HINCRBY / INCRBY.
-------------------------------------------------------------------------------
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
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

_TIER_KEY_PREFIX = "stas:tiers:"
_TIER_USAGE_KEY = "usage"
_TIER_VERIFIED_KEY = "verified"
_TIER_LAST_FIX_KEY = "last_fix_ts"
_TIER_PQL_KEY_PREFIX = "stas:pql:"
_TIER_PQL_SCORE_KEY = "score"


def _get_redis() -> Any:
    """Get-or-create the shared Redis client for tier tracking."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        _REDIS_CLIENT = _redis_mod.from_url(_REDIS_URL, decode_responses=True)
        _REDIS_CLIENT.ping()
        logger.info("Tier Redis connected -- url=%s", _REDIS_URL)
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Tier Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Canonical tier definitions
# ---------------------------------------------------------------------------

TIER_DEFINITIONS: dict[str, dict[str, Any]] = {
    "free": {
        "max_fixes": 10,
        "display_name": "Free",
        "monthly_price": 0,
        "features": ["10 fixes/month", "Community support", "Basic analytics"],
        "nudge_at": 8,
        "wall_at": 10,
    },
    "solo": {
        "max_fixes": 50,
        "display_name": "Solo",
        "monthly_price": 49,
        "features": ["50 fixes/month", "Email support", "Full analytics", "Priority queue"],
        "nudge_at": None,
        "wall_at": None,
    },
    "team": {
        "max_fixes": -1,  # -1 = unlimited
        "display_name": "Team",
        "monthly_price": 149,
        "features": ["Unlimited fixes", "Slack support", "Full analytics", "Priority queue", "SLA"],
        "nudge_at": None,
        "wall_at": None,
    },
    "enterprise": {
        "max_fixes": -1,
        "display_name": "Enterprise",
        "monthly_price": None,
        "features": ["Unlimited fixes", "Dedicated support", "Custom SLA", "SSO", "VPC deployment"],
        "nudge_at": None,
        "wall_at": None,
    },
}

_TIER_NAMES = frozenset(TIER_DEFINITIONS)
_DEFAULT_TIER = "free"

# PQL scoring weights
_PQL_FIX_WEIGHT = 1.0
_PQL_VERIFIED_WEIGHT = 2.0
_PQL_ACTIVE_DAY_WEIGHT = 0.5
_PQL_REPO_WEIGHT = 1.0
_PQL_REPO_MAX = 5.0
_PQL_WEBHOOK_WEIGHT = 3.0
_PQL_READY_THRESHOLD = 7.0

# Inactivity threshold
_INACTIVITY_DAYS = int(os.getenv("TIER_INACTIVITY_DAYS", "14"))


# ---------------------------------------------------------------------------
# Tier resolution helpers
# ---------------------------------------------------------------------------


def resolve_tier(tenant_id: str) -> str:
    """Resolve a tenant's tier from environment (TENANT_{ID}_TIER) or default."""
    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    tier = os.getenv(env_var, _DEFAULT_TIER).lower()
    if tier in _TIER_NAMES:
        return tier
    return _DEFAULT_TIER


def tier_max_fixes(tier: str) -> int:
    """Return the max fixes for a tier (-1 = unlimited)."""
    return TIER_DEFINITIONS.get(tier, TIER_DEFINITIONS[_DEFAULT_TIER])["max_fixes"]


def tier_display_name(tier: str) -> str:
    """Return the display name for a tier."""
    return TIER_DEFINITIONS.get(tier, TIER_DEFINITIONS[_DEFAULT_TIER])["display_name"]


def tier_nudge_at(tier: str) -> int | None:
    """Return the fix count at which to nudge the tenant to upgrade, or None."""
    return TIER_DEFINITIONS.get(tier, TIER_DEFINITIONS[_DEFAULT_TIER]).get("nudge_at")


def tier_wall_at(tier: str) -> int | None:
    """Return the fix count at which to block the tenant, or None."""
    return TIER_DEFINITIONS.get(tier, TIER_DEFINITIONS[_DEFAULT_TIER]).get("wall_at")


# ---------------------------------------------------------------------------
# Usage counter helpers
# ---------------------------------------------------------------------------


def _tier_key(tenant_id: str) -> str:
    return f"{_TIER_KEY_PREFIX}{tenant_id}"


def _pql_key(tenant_id: str) -> str:
    return f"{_TIER_PQL_KEY_PREFIX}{tenant_id}"


def increment_tier_usage(tenant_id: str) -> int:
    """Atomically increment the fix usage counter for a tenant.

    Returns the new usage count.
    """
    client = _get_redis()
    if not client:
        logger.warning("Redis unavailable -- tier usage increment skipped for tenant=%s", tenant_id)
        return 0

    try:
        key = _tier_key(tenant_id)
        now_ts = int(time.time())
        pipe = client.pipeline()
        pipe.hincrby(key, _TIER_USAGE_KEY, 1)
        pipe.hset(key, _TIER_LAST_FIX_KEY, str(now_ts))
        pipe.expire(key, 62 * 24 * 60 * 60)
        results = pipe.execute()
        new_count = results[0]
        logger.debug("Tier usage incremented tenant=%s count=%d", tenant_id, new_count)
        return int(new_count)
    except Exception as exc:
        logger.error("Failed to increment tier usage tenant=%s -- %s", tenant_id, exc)
        return 0


def increment_tier_verified(tenant_id: str) -> int:
    """Atomically increment the verified fix counter for a tenant.

    Verified = the fix passed the test suite verification gate.
    Returns the new verified count.
    """
    client = _get_redis()
    if not client:
        return 0

    try:
        key = _tier_key(tenant_id)
        pipe = client.pipeline()
        pipe.hincrby(key, _TIER_VERIFIED_KEY, 1)
        pipe.expire(key, 62 * 24 * 60 * 60)
        results = pipe.execute()
        return int(results[0])
    except Exception as exc:
        logger.error("Failed to increment tier verified tenant=%s -- %s", tenant_id, exc)
        return 0


def get_tier_usage(tenant_id: str) -> dict[str, Any]:
    """Get the full tier usage state for a tenant.

    Returns::

        {
            "tenant_id": str,
            "tier": str,
            "usage": int,
            "verified": int,
            "max_fixes": int,         # -1 = unlimited
            "remaining": int,         # -1 = unlimited
            "last_fix_ts": int | None,
            "display": str,           # human-readable usage string
        }
    """
    client = _get_redis()
    tier = resolve_tier(tenant_id)
    max_fixes = tier_max_fixes(tier)

    if not client:
        return {
            "tenant_id": tenant_id,
            "tier": tier,
            "usage": 0,
            "verified": 0,
            "max_fixes": max_fixes,
            "remaining": -1 if max_fixes < 0 else max_fixes,
            "last_fix_ts": None,
            "display": _build_display(0, -1 if max_fixes < 0 else max_fixes, tier),
        }

    try:
        key = _tier_key(tenant_id)
        data = client.hgetall(key)
        usage = int(data.get(_TIER_USAGE_KEY, 0))
        verified = int(data.get(_TIER_VERIFIED_KEY, 0))
        last_fix_raw = data.get(_TIER_LAST_FIX_KEY)
        last_fix_ts = int(last_fix_raw) if last_fix_raw else None

        if max_fixes < 0:
            remaining = -1
        else:
            remaining = max(0, max_fixes - usage)

        return {
            "tenant_id": tenant_id,
            "tier": tier,
            "usage": usage,
            "verified": verified,
            "max_fixes": max_fixes,
            "remaining": remaining,
            "last_fix_ts": last_fix_ts,
            "display": _build_display(usage, remaining, tier),
        }
    except Exception as exc:
        logger.error("Failed to get tier usage tenant=%s -- %s", tenant_id, exc)
        return {
            "tenant_id": tenant_id,
            "tier": tier,
            "usage": 0,
            "verified": 0,
            "max_fixes": max_fixes,
            "remaining": -1 if max_fixes < 0 else max_fixes,
            "last_fix_ts": None,
            "display": _build_display(0, -1 if max_fixes < 0 else max_fixes, tier),
        }


def _build_display(usage: int, remaining: int, tier: str) -> str:
    """Build a human-readable usage display string."""
    if remaining < 0:
        total = usage
        return f"{usage}/{total} fixes (unlimited)"
    total = usage + remaining
    return f"{usage}/{total} fixes ({tier_display_name(tier)} tier)"


# ---------------------------------------------------------------------------
# PQL scoring
# ---------------------------------------------------------------------------


@dataclass
class PqlScore:
    """Per-tenant product-qualified lead score."""

    tenant_id: str
    score: float = 0.0
    fix_component: float = 0.0
    verified_component: float = 0.0
    active_days_component: float = 0.0
    repo_component: float = 0.0
    webhook_component: float = 0.0
    updated_at: float = field(default_factory=time.time)

    def is_conversion_ready(self) -> bool:
        """Return True if the PQL score is above the ready threshold."""
        return self.score >= _PQL_READY_THRESHOLD

    def to_dict(self) -> dict[str, Any]:
        return {
            **asdict(self),
            "is_conversion_ready": self.is_conversion_ready(),
            "threshold": _PQL_READY_THRESHOLD,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PqlScore:
        return cls(
            tenant_id=data["tenant_id"],
            score=data.get("score", 0.0),
            fix_component=data.get("fix_component", 0.0),
            verified_component=data.get("verified_component", 0.0),
            active_days_component=data.get("active_days_component", 0.0),
            repo_component=data.get("repo_component", 0.0),
            webhook_component=data.get("webhook_component", 0.0),
            updated_at=data.get("updated_at", time.time()),
        )


def compute_pql_score(
    tenant_id: str,
    usage: int | None = None,
    verified: int | None = None,
    active_days: int = 0,
    repos_connected: int = 0,
    webhook_configured: bool = False,
) -> PqlScore:
    """Compute a PQL score for a tenant based on engagement signals.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.
    usage : int | None
        Total fix usage. If None, read from Redis.
    verified : int | None
        Total verified fixes. If None, read from Redis.
    active_days : int
        Approximate consecutive days the tenant has been active.
    repos_connected : int
        Number of repositories connected.
    webhook_configured : bool
        Whether the webhook is configured.

    Returns
    -------
    PqlScore
        The computed PQL score with component breakdown.
    """
    if usage is None or verified is None:
        try:
            tier_data = get_tier_usage(tenant_id)
            usage = usage if usage is not None else tier_data.get("usage", 0)
            verified = verified if verified is not None else tier_data.get("verified", 0)
        except Exception as exc:
            logger.warning("Failed to read usage for PQL tenant=%s -- %s", tenant_id, exc)
            usage = usage or 0
            verified = verified or 0

    fix_component = usage * _PQL_FIX_WEIGHT
    verified_component = verified * _PQL_VERIFIED_WEIGHT
    active_days_component = active_days * _PQL_ACTIVE_DAY_WEIGHT
    repo_component = min(repos_connected * _PQL_REPO_WEIGHT, _PQL_REPO_MAX)
    webhook_component = _PQL_WEBHOOK_WEIGHT if webhook_configured else 0.0

    total = (
        fix_component
        + verified_component
        + active_days_component
        + repo_component
        + webhook_component
    )

    score = PqlScore(
        tenant_id=tenant_id,
        score=total,
        fix_component=fix_component,
        verified_component=verified_component,
        active_days_component=active_days_component,
        repo_component=repo_component,
        webhook_component=webhook_component,
    )

    _persist_pql_score(score)

    return score


def _persist_pql_score(score: PqlScore) -> None:
    """Persist PQL score to Redis."""
    client = _get_redis()
    if not client:
        return
    try:
        key = _pql_key(score.tenant_id)
        client.setex(key, 62 * 24 * 60 * 60, json.dumps(score.to_dict()))
    except Exception as exc:
        logger.warning("Failed to persist PQL score for %s -- %s", score.tenant_id, exc)


def get_pql_score(tenant_id: str) -> PqlScore | None:
    """Load a cached PQL score from Redis, or None if not found."""
    client = _get_redis()
    if not client:
        return None
    try:
        raw = client.get(_pql_key(tenant_id))
        if raw:
            data = json.loads(raw)
            return PqlScore.from_dict(data)
    except Exception as exc:
        logger.warning("Failed to load PQL score for %s -- %s", tenant_id, exc)
    return None


# ---------------------------------------------------------------------------
# Activity check
# ---------------------------------------------------------------------------


def is_inactive(tenant_id: str, days: int = _INACTIVITY_DAYS) -> bool:
    """Check if a tenant has been inactive for ``days`` or more.

    Uses the ``last_fix_ts`` field from the tier usage record. If no record
    exists, the tenant is considered not inactive (they haven't started yet).
    """
    client = _get_redis()
    if not client:
        return False

    try:
        key = _tier_key(tenant_id)
        last_fix_raw = client.hget(key, _TIER_LAST_FIX_KEY)
        if last_fix_raw is None:
            return False
        last_fix_ts = int(last_fix_raw)
        elapsed = time.time() - last_fix_ts
        return elapsed >= days * 24 * 60 * 60
    except Exception as exc:
        logger.warning("Failed to check inactivity tenant=%s -- %s", tenant_id, exc)
        return False


# ---------------------------------------------------------------------------
# Celery beat task: periodic PQL recalculation
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.billing.tiers.recalculate_pql_scores",
)
def recalculate_pql_scores(self: Any) -> dict[str, Any]:
    """Iterate all tenants with tier usage records and recalculate PQL scores.

    Uses Redis SCAN to find all ``stas:tiers:*`` keys, reads usage and
    verification counts, and recomputes the PQL score for each tenant.

    Returns a summary dict with counts of processed tenants.
    """
    client = _get_redis()
    if not client:
        return {"processed": 0, "error": "Redis unavailable"}

    processed = 0
    errors = 0
    cursor = 0

    try:
        while True:
            cursor, keys = client.scan(cursor, match=f"{_TIER_KEY_PREFIX}*", count=100)
            for key in keys:
                tenant_id = key[len(_TIER_KEY_PREFIX):]
                try:
                    data = client.hgetall(key)
                    usage = int(data.get(_TIER_USAGE_KEY, 0))
                    verified = int(data.get(_TIER_VERIFIED_KEY, 0))
                    compute_pql_score(tenant_id, usage=usage, verified=verified)
                    processed += 1
                except Exception as exc:
                    logger.warning("PQL recalculation failed for %s -- %s", tenant_id, exc)
                    errors += 1
            if cursor == 0:
                break
    except Exception as exc:
        logger.error("PQL scan failed -- %s", exc)

    summary = {
        "processed": processed,
        "errors": errors,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("PQL recalculation complete -- %s", json.dumps(summary))
    return summary


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
