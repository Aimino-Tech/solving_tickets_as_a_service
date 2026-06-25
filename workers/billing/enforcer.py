"""
Tier enforcement gate — check tenant usage against plan limits before dispatch.

Provides the pre-flight check that decides whether a tenant can run a fix.
Called by the pipeline orchestrator before enqueuing an agent dispatch task.

── Design ───────────────────────────────────────────────────────────────────
- ``check_and_block()`` is the main entry point: it reads the tenant's current
  usage from Redis (via ``workers.billing.usage``), compares it against the
  tier's max_issues limit, and returns an EnforcementResult.
- At 80% of the limit, a warning flag is set (caller can use this to surface
  a UI warning or send a notification).
- At 100% (or above), the fix is blocked with an upgrade prompt.
- The ``EnforcementResult`` is serialisable JSON — the Express caller receives
  it via the task result backend.

── Tier Limits ──────────────────────────────────────────────────────────────
  free:        10 fixes/mo
  pro/solo:   100 fixes/mo
  team:       500 fixes/mo
  enterprise: unlimited (-1)

── Error Handling ───────────────────────────────────────────────────────────
- If Redis is unavailable, the gate allows the fix through (fail-open) and
  logs a warning. This ensures billing issues never block critical fixes.
- Unknown tenant IDs are treated as "free" tier.
- If the usage counter has no record for a tenant, 0 usage is assumed.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default tier limits (can be overridden via env vars)
# ---------------------------------------------------------------------------

_TIER_MAX_ISSUES: dict[str, int] = {
    "free": int(os.getenv("TIER_FREE_MAX_ISSUES", "10")),
    "pro": int(os.getenv("TIER_PRO_MAX_ISSUES", "100")),
    "team": int(os.getenv("TIER_TEAM_MAX_ISSUES", "500")),
    "enterprise": int(os.getenv("TIER_ENTERPRISE_MAX_ISSUES", "-1")),  # -1 = unlimited
}

_TIER_NAMES = frozenset(_TIER_MAX_ISSUES)
_WARN_THRESHOLD = float(os.getenv("TIER_WARN_THRESHOLD", "0.8"))  # 80%


def _resolve_tier(tenant_id: str) -> str:
    """Resolve a tenant's tier from environment (TENANT_{ID}_TIER) or default."""
    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    tier = os.getenv(env_var, "free").lower()
    if tier in _TIER_NAMES:
        return tier
    return "free"


def _max_issues(tier: str) -> int:
    """Return the max issues for a tier (-1 = unlimited)."""
    return _TIER_MAX_ISSUES.get(tier, 10)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


class EnforcementResult:
    """
    Result of a tier enforcement check.

    Attributes
    ----------
    allowed : bool
        Whether the fix is allowed to proceed.
    tenant_id : str
        The tenant identifier.
    tier : str
        Resolved tier name.
    usage : int
        Current usage count.
    limit : int
        Maximum allowed issues for this tier (-1 = unlimited).
    remaining : int
        Remaining fixes before limit (-1 = unlimited).
    blocked_reason : str | None
        If blocked, a human-readable reason (with upgrade prompt).
    warning : str | None
        If at 80% threshold, a warning message.
    """

    def __init__(
        self,
        allowed: bool,
        tenant_id: str,
        tier: str,
        usage: int,
        limit: int,
        remaining: int,
        blocked_reason: str | None = None,
        warning: str | None = None,
    ) -> None:
        self.allowed = allowed
        self.tenant_id = tenant_id
        self.tier = tier
        self.usage = usage
        self.limit = limit
        self.remaining = remaining
        self.blocked_reason = blocked_reason
        self.warning = warning

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "tenant_id": self.tenant_id,
            "tier": self.tier,
            "usage": self.usage,
            "limit": self.limit,
            "remaining": self.remaining,
            "blocked_reason": self.blocked_reason,
            "warning": self.warning,
        }

    def __repr__(self) -> str:
        return (
            f"EnforcementResult(allowed={self.allowed}, tenant={self.tenant_id}, "
            f"tier={self.tier}, usage={self.usage}/{self.limit})"
        )


def _build_upgrade_prompt(tier: str, limit: int) -> str:
    """Return a human-readable upgrade prompt based on current tier."""
    prompts: dict[str, str] = {
        "free": (
            f"You have reached the Free tier limit of {limit} fixes per month. "
            "Upgrade to Solo ($49/mo) for 100 fixes/mo with premium models, "
            "or to Team ($149/mo) for 500 fixes/mo with priority support."
        ),
        "pro": (
            f"You have reached the Solo plan limit of {limit} fixes per month. "
            "Upgrade to Team ($149/mo) for 500 fixes/mo with priority support."
        ),
        "team": (
            f"You have reached the Team plan limit of {limit} fixes per month. "
            "Contact sales for Enterprise plans with unlimited fixes."
        ),
    }
    return prompts.get(tier, f"You have reached the plan limit of {limit} fixes. Please upgrade to continue.")


def _build_warning(tier: str, usage: int, limit: int) -> str:
    """Return a warning message when approaching the limit."""
    pct = round(usage / limit * 100)
    remaining = limit - usage
    return (
        f"You have used {pct}% of your {tier.title()} tier limit ({usage}/{limit}). "
        f"Only {remaining} fix(es) remaining this billing period. "
        "Upgrade to avoid interruption."
    )


# ---------------------------------------------------------------------------
# Main enforcement check
# ---------------------------------------------------------------------------


def check_and_block(tenant_id: str, tier_override: str | None = None) -> EnforcementResult:
    """
    Pre-flight check: can this tenant run a fix?

    Steps:
    1. Resolve the tenant's tier.
    2. Read current usage from Redis (via workers.billing.usage).
    3. If limit is -1 (enterprise), allow immediately.
    4. If usage >= limit, block with upgrade prompt.
    5. If usage >= 80% of limit, allow but set warning.
    6. Otherwise, allow.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier (e.g. account UUID or Stripe customer ID).
    tier_override : str, optional
        Override the tier resolution (used when the caller already knows
        the tier from the billing database).

    Returns
    -------
    EnforcementResult
        Serializable result with ``allowed``, ``blocked_reason``, ``warning``.
    """
    tier = tier_override.lower() if tier_override else _resolve_tier(tenant_id)
    limit = _max_issues(tier)

    # Enterprise/unlimited — always allow
    if limit < 0:
        return EnforcementResult(
            allowed=True,
            tenant_id=tenant_id,
            tier=tier,
            usage=0,
            limit=-1,
            remaining=-1,
        )

    # Read usage from Redis
    try:
        from workers.billing.usage import get_usage as _get_usage

        usage_data = _get_usage(tenant_id)
        usage = usage_data.get("count", 0)
    except Exception as exc:
        logger.warning(
            "Usage lookup failed for tenant=%s — allowing through: %s",
            tenant_id,
            exc,
        )
        return EnforcementResult(
            allowed=True,
            tenant_id=tenant_id,
            tier=tier,
            usage=0,
            limit=limit,
            remaining=limit,
            warning="Unable to verify usage. Fix will proceed but may exceed plan limit.",
        )

    remaining = max(0, limit - usage)

    # Block if at or over limit
    if usage >= limit:
        reason = _build_upgrade_prompt(tier, limit)
        logger.info(
            "Blocked fix tenant=%s tier=%s usage=%d limit=%d",
            tenant_id,
            tier,
            usage,
            limit,
        )
        return EnforcementResult(
            allowed=False,
            tenant_id=tenant_id,
            tier=tier,
            usage=usage,
            limit=limit,
            remaining=0,
            blocked_reason=reason,
        )

    # Warn at threshold
    warning: str | None = None
    if usage >= int(limit * _WARN_THRESHOLD):
        warning = _build_warning(tier, usage, limit)
        logger.info(
            "Usage warning tenant=%s tier=%s usage=%d limit=%d threshold=%.0f%%",
            tenant_id,
            tier,
            usage,
            limit,
            _WARN_THRESHOLD * 100,
        )

    return EnforcementResult(
        allowed=True,
        tenant_id=tenant_id,
        tier=tier,
        usage=usage,
        limit=limit,
        remaining=remaining,
        warning=warning,
    )
