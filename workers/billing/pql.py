"""
PQL conversion nudges, upgrade wall, and inactivity alerts (AIM-2077).

Provides the product-qualified lead (PQL) conversion funnel logic:

1. **Nudge at fix #8** -- When a free-tier tenant reaches 8 fixes (2 remaining),
   post a comment on their issue/PR suggesting an upgrade to avoid interruption.

2. **Upgrade wall at fix #10** -- At 10 fixes, the free tier reaches its hard
   limit. ``check_wall()`` returns a block signal that the middleware uses to
   reject further fix runs until the tenant upgrades.

3. **Inactivity alert** -- If a tenant has been inactive for 14+ days (no fix
   run recorded), ``check_inactivity()`` returns a re-engagement signal.

-- Design -----------------------------------------------------------------------
- All decisions are driven by the usage counters in ``workers.billing.tiers``.
- Nudge/wall thresholds are derived from the canonical ``TIER_DEFINITIONS``
  dict (``nudge_at`` and ``wall_at`` fields).
- Inactivity is detected by comparing ``last_fix_ts`` to the current time.
- All checks return structured results the caller (middleware, Express API)
  can act on without parsing strings.

-- Error Handling -----------------------------------------------------------------
- Redis failures return safe defaults: no nudge, no wall block, no alert.
- Unknown tenant IDs default to "free" tier with 0 usage.
----------------------------------------------------------------------------------
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from workers.billing.tiers import (
    TIER_DEFINITIONS,
    get_tier_usage,
    is_inactive,
    resolve_tier,
    tier_nudge_at,
    tier_wall_at,
)

logger = logging.getLogger(__name__)

_INACTIVITY_DAYS = int(os.getenv("TIER_INACTIVITY_DAYS", "14"))


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


class NudgeResult:
    """Result of a PQL nudge check.

    Attributes
    ----------
    should_nudge : bool
        Whether a nudge should be shown.
    tenant_id : str
        The tenant identifier.
    tier : str
        Resolved tier name.
    usage : int
        Current usage count.
    limit : int
        Maximum allowed fixes for the tier.
    remaining : int
        Fixes remaining before the wall.
    message : str | None
        The nudge message, if should_nudge is True.
    """

    def __init__(
        self,
        should_nudge: bool,
        tenant_id: str,
        tier: str,
        usage: int,
        limit: int,
        remaining: int,
        message: str | None = None,
    ) -> None:
        self.should_nudge = should_nudge
        self.tenant_id = tenant_id
        self.tier = tier
        self.usage = usage
        self.limit = limit
        self.remaining = remaining
        self.message = message

    def to_dict(self) -> dict[str, Any]:
        return {
            "should_nudge": self.should_nudge,
            "tenant_id": self.tenant_id,
            "tier": self.tier,
            "usage": self.usage,
            "limit": self.limit,
            "remaining": self.remaining,
            "message": self.message,
        }

    def __repr__(self) -> str:
        return (
            f"NudgeResult(should_nudge={self.should_nudge}, tenant={self.tenant_id}, "
            f"tier={self.tier}, usage={self.usage}/{self.limit})"
        )


class WallResult:
    """Result of a tier wall check.

    Attributes
    ----------
    blocked : bool
        Whether the fix run is blocked by the tier wall.
    tenant_id : str
        The tenant identifier.
    tier : str
        Resolved tier name.
    usage : int
        Current usage count.
    limit : int
        Maximum allowed fixes for the tier.
    reason : str | None
        If blocked, a human-readable explanation with upgrade prompt.
    """

    def __init__(
        self,
        blocked: bool,
        tenant_id: str,
        tier: str,
        usage: int,
        limit: int,
        reason: str | None = None,
    ) -> None:
        self.blocked = blocked
        self.tenant_id = tenant_id
        self.tier = tier
        self.usage = usage
        self.limit = limit
        self.reason = reason

    def to_dict(self) -> dict[str, Any]:
        return {
            "blocked": self.blocked,
            "tenant_id": self.tenant_id,
            "tier": self.tier,
            "usage": self.usage,
            "limit": self.limit,
            "reason": self.reason,
        }

    def __repr__(self) -> str:
        return (
            f"WallResult(blocked={self.blocked}, tenant={self.tenant_id}, "
            f"tier={self.tier}, usage={self.usage}/{self.limit})"
        )


class InactivityResult:
    """Result of an inactivity check.

    Attributes
    ----------
    is_inactive : bool
        Whether the tenant has been inactive for the threshold period.
    tenant_id : str
        The tenant identifier.
    inactive_days : int
        Number of days since last fix run.
    threshold_days : int
        The inactivity threshold in days.
    alert : str | None
        Alert message, if is_inactive is True.
    """

    def __init__(
        self,
        is_inactive: bool,
        tenant_id: str,
        inactive_days: int | None = None,
        threshold_days: int = _INACTIVITY_DAYS,
        alert: str | None = None,
    ) -> None:
        self.is_inactive = is_inactive
        self.tenant_id = tenant_id
        self.inactive_days = inactive_days
        self.threshold_days = threshold_days
        self.alert = alert

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_inactive": self.is_inactive,
            "tenant_id": self.tenant_id,
            "inactive_days": self.inactive_days,
            "threshold_days": self.threshold_days,
            "alert": self.alert,
        }

    def __repr__(self) -> str:
        return (
            f"InactivityResult(is_inactive={self.is_inactive}, tenant={self.tenant_id}, "
            f"days={self.inactive_days}/{self.threshold_days})"
        )


# ---------------------------------------------------------------------------
# PQL nudge check (triggered at fix #N before the wall)
# ---------------------------------------------------------------------------


def _build_nudge_message(tenant_id: str, tier: str, usage: int, limit: int, remaining: int) -> str:
    """Build a friendly nudge message for a free-tier user nearing the limit."""
    return (
        f"You've used {usage} out of {limit} free fixes this month "
        f"({remaining} fix{'es' if remaining != 1 else ''} remaining).\n\n"
        "### Why upgrade?\n"
        "Upgrade to **Solo ($49/mo)** for:\n"
        "- **50 fixes/month** -- 5x more capacity\n"
        "- **Priority queue** -- your fixes jump the line\n"
        "- **Email support** -- get help when you need it\n"
        "- **Full analytics** -- see fix history, pass rates, trends\n\n"
        "Don't lose momentum. [Upgrade here](https://syntaro.dev/pricing) ->"
    )


def check_nudge(tenant_id: str, nudge_override: int | None = None) -> NudgeResult:
    """Check whether a PQL upgrade nudge should be shown.

    A nudge fires when:
    1. The tenant is on a tier that defines a ``nudge_at`` value.
    2. Current usage >= nudge_at threshold.
    3. The tenant has not already hit the wall (usage < limit).

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.
    nudge_override : int | None
        Override the nudge threshold (for testing).

    Returns
    -------
    NudgeResult
        Result indicating whether to show a nudge.
    """
    try:
        usage_data = get_tier_usage(tenant_id)
    except Exception as exc:
        logger.warning("Failed to read usage for nudge tenant=%s -- %s", tenant_id, exc)
        return NudgeResult(False, tenant_id, "free", 0, 10, 10)

    tier = usage_data["tier"]
    usage = usage_data["usage"]
    limit = usage_data["max_fixes"]
    remaining = usage_data["remaining"]

    # Unlimited tiers never nudge
    if limit < 0:
        return NudgeResult(False, tenant_id, tier, usage, limit, remaining)

    nudge_at = nudge_override if nudge_override is not None else tier_nudge_at(tier)

    # No nudge threshold defined for this tier
    if nudge_at is None:
        return NudgeResult(False, tenant_id, tier, usage, limit, remaining)

    # Already at or past the wall -- nudge is moot
    if usage >= limit:
        return NudgeResult(False, tenant_id, tier, usage, limit, remaining)

    # Check if usage meets the nudge threshold
    if usage >= nudge_at:
        message = _build_nudge_message(tenant_id, tier, usage, limit, remaining)
        logger.info(
            "PQL nudge tenant=%s tier=%s usage=%d limit=%d nudge_at=%d",
            tenant_id,
            tier,
            usage,
            limit,
            nudge_at,
        )
        return NudgeResult(True, tenant_id, tier, usage, limit, remaining, message=message)

    return NudgeResult(False, tenant_id, tier, usage, limit, remaining)


# ---------------------------------------------------------------------------
# Upgrade wall check (hard block at fix #N)
# ---------------------------------------------------------------------------


def _build_wall_message(tenant_id: str, tier: str, usage: int, limit: int) -> str:
    """Build an upgrade-required message for the wall."""
    tier_def = TIER_DEFINITIONS.get(tier, TIER_DEFINITIONS.get("free", {}))
    solo_price = TIER_DEFINITIONS.get("solo", {}).get("monthly_price", 49)
    team_price = TIER_DEFINITIONS.get("team", {}).get("monthly_price", 149)

    return (
        f"You have reached the **{tier_def.get('display_name', tier)}** tier limit of "
        f"{limit} fixes per month.\n\n"
        "### Upgrade to continue\n"
        "Your fix runs are paused until you upgrade:\n\n"
        f"- **Solo** -- ${solo_price}/mo for 50 fixes/month\n"
        f"- **Team** -- ${team_price}/mo for unlimited fixes with priority support\n\n"
        "Don't lose your progress. [Upgrade here](https://syntaro.dev/pricing) ->\n\n"
        "*Your PQL score and usage data are preserved. You won't lose anything by upgrading.*"
    )


def check_wall(tenant_id: str, wall_override: int | None = None) -> WallResult:
    """Check whether the tenant has hit the upgrade wall.

    The wall fires when:
    1. The tenant is on a tier that defines a ``wall_at`` value.
    2. Current usage >= wall_at threshold.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.
    wall_override : int | None
        Override the wall threshold (for testing).

    Returns
    -------
    WallResult
        Result indicating whether the fix is blocked.
    """
    try:
        usage_data = get_tier_usage(tenant_id)
    except Exception as exc:
        logger.warning("Failed to read usage for wall tenant=%s -- %s", tenant_id, exc)
        return WallResult(False, tenant_id, "free", 0, 10)

    tier = usage_data["tier"]
    usage = usage_data["usage"]
    limit = usage_data["max_fixes"]

    # Unlimited tiers never wall
    if limit < 0:
        return WallResult(False, tenant_id, tier, usage, limit)

    wall_at = wall_override if wall_override is not None else tier_wall_at(tier)

    # No wall threshold defined for this tier
    if wall_at is None:
        return WallResult(False, tenant_id, tier, usage, limit)

    if usage >= wall_at:
        reason = _build_wall_message(tenant_id, tier, usage, limit)
        logger.info(
            "Upgrade wall hit tenant=%s tier=%s usage=%d limit=%d wall_at=%d",
            tenant_id,
            tier,
            usage,
            limit,
            wall_at,
        )
        return WallResult(True, tenant_id, tier, usage, limit, reason=reason)

    return WallResult(False, tenant_id, tier, usage, limit)


# ---------------------------------------------------------------------------
# Inactivity alert (14-day no-activity detection)
# ---------------------------------------------------------------------------


def _build_inactivity_alert(tenant_id: str, inactive_days: int) -> str:
    """Build a re-engagement message for an inactive tenant."""
    return (
        f"**Heads up!** It's been **{inactive_days} days** since your last fix run.\n\n"
        "Your SYNTARO integration is still active, but we noticed things have gone quiet. "
        "Here's what you can do:\n\n"
        "- Label an issue with **syntaro:fix** to trigger a new fix run\n"
        "- Check your [dashboard](https://syntaro.dev/dashboard) for recent run history\n"
        "- Upgrade to [Solo ($49/mo)](https://syntaro.dev/pricing) for higher limits\n\n"
        "Need help? Reply to this issue or email support@syntaro.dev."
    )


def check_inactivity(
    tenant_id: str,
    days_override: int | None = None,
) -> InactivityResult:
    """Check whether a tenant has been inactive beyond the threshold.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.
    days_override : int | None
        Override the inactivity threshold (for testing).

    Returns
    -------
    InactivityResult
        Result indicating whether the tenant is inactive.
    """
    threshold = days_override if days_override is not None else _INACTIVITY_DAYS

    try:
        inactive = is_inactive(tenant_id, threshold)
    except Exception as exc:
        logger.warning("Failed to check inactivity tenant=%s -- %s", tenant_id, exc)
        return InactivityResult(False, tenant_id, threshold_days=threshold)

    if not inactive:
        return InactivityResult(False, tenant_id, threshold_days=threshold)

    # Calculate approximate inactive days
    try:
        usage_data = get_tier_usage(tenant_id)
        last_fix_ts = usage_data.get("last_fix_ts")
        if last_fix_ts:
            import time
            inactive_days = int((time.time() - last_fix_ts) / (24 * 60 * 60))
        else:
            inactive_days = threshold
    except Exception:
        inactive_days = threshold

    alert = _build_inactivity_alert(tenant_id, inactive_days)
    logger.info(
        "Inactivity alert tenant=%s inactive_days=%d threshold=%d",
        tenant_id,
        inactive_days,
        threshold,
    )

    return InactivityResult(
        is_inactive=True,
        tenant_id=tenant_id,
        inactive_days=inactive_days,
        threshold_days=threshold,
        alert=alert,
    )
