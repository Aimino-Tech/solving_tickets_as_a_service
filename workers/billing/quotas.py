"""
Unified quota enforcement — tier-based limits across resource types.

Provides the canonical tier-limit definitions, a ``QuotaResult`` type, and the
primary ``check_quota()`` enforcement function. This module consolidates the
tier → limit mapping and pre-flight check into a single surface consumed by
Celery tasks, the Express webhook server, and the usage dashboard.

── Resource Types ────────────────────────────────────────────────────────────
Each tier defines limits for the following resource types:

  fixes        →  max fix runs per billing period
  storage      →  max workspace disk usage (in bytes)
  workspaces   →  max concurrent workspace count
  api_rate     →  max API requests per minute (per-tenant rate limit)

── Tier Limits ───────────────────────────────────────────────────────────────
  free:        10 fixes,   512 MB storage,    5 workspaces,   10  req/min
  solo:       100 fixes,     2 GB storage,   20 workspaces,   60  req/min
  team:       500 fixes,     5 GB storage,   50 workspaces,  300  req/min
  enterprise:  -1 (unlimited fixes), 10 GB storage, 100 workspaces, 1000 req/min

── Error Handling ───────────────────────────────────────────────────────────
- Redis connection failures return safe defaults (0 usage) and allow the
  request through (fail-open) with a warning.
- Unknown tenant IDs default to "free" tier.
- Unknown resource types raise a ``ValueError``.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, asdict, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Canonical tier limit definitions
# ---------------------------------------------------------------------------

# Each entry maps a tier name to a dict of resource → numeric limit.
# -1 means unlimited for that resource.
TIER_LIMITS: dict[str, dict[str, int]] = {
    "free": {
        "fixes": 10,
        "storage": 512 * 1024 * 1024,       # 512 MB
        "workspaces": 5,
        "api_rate": 10,
    },
    "solo": {
        "fixes": 100,
        "storage": 2 * 1024 * 1024 * 1024,  # 2 GB
        "workspaces": 20,
        "api_rate": 60,
    },
    "team": {
        "fixes": 500,
        "storage": 5 * 1024 * 1024 * 1024,  # 5 GB
        "workspaces": 50,
        "api_rate": 300,
    },
    "enterprise": {
        "fixes": -1,
        "storage": 10 * 1024 * 1024 * 1024,  # 10 GB
        "workspaces": 100,
        "api_rate": 1000,
    },
}

_TIER_NAMES = frozenset(TIER_LIMITS)
_DEFAULT_TIER = "free"

# Resource-type display names for messages
_RESOURCE_LABELS: dict[str, str] = {
    "fixes": "fixes",
    "storage": "storage",
    "workspaces": "workspaces",
    "api_rate": "API requests",
}

# Resource types that support "-1 = unlimited"
_UNLIMITED_RESOURCES = frozenset({"fixes", "storage"})

# ---------------------------------------------------------------------------
# Tier resolution
# ---------------------------------------------------------------------------


def resolve_tier(tenant_id: str, tier_override: str | None = None) -> str:
    """Resolve a tenant's tier.

    Priority:
    1. ``tier_override`` — provided by caller (e.g. from billing DB).
    2. Environment variable ``TENANT_{ID}_TIER`` — per-tenant override.
    3. ``_DEFAULT_TIER`` (``"free"``).

    If the resolved name is not one of the known tiers, falls back to *free*.
    """
    if tier_override:
        tier = tier_override.lower()
        if tier in _TIER_NAMES:
            return tier
        logger.warning("Unknown tier_override=%r — falling back to %s", tier_override, _DEFAULT_TIER)
        return _DEFAULT_TIER

    env_var = f"TENANT_{tenant_id.upper().replace('-', '_')}_TIER"
    tier = os.getenv(env_var, _DEFAULT_TIER).lower()
    if tier in _TIER_NAMES:
        return tier
    return _DEFAULT_TIER


def tier_limit(tier: str, resource: str) -> int:
    """Return the numeric limit for ``resource`` in ``tier`` (``-1`` = unlimited).

    Raises ``ValueError`` for unknown resource types.
    """
    limits = TIER_LIMITS.get(tier, TIER_LIMITS[_DEFAULT_TIER])
    if resource not in limits:
        msg = f"Unknown resource type {resource!r}. Valid: {list(limits)}"
        raise ValueError(msg)
    return limits[resource]


def is_unlimited(limit: int, resource: str) -> bool:
    """Return ``True`` if ``limit == -1`` and the resource supports unlimited."""
    if resource not in _UNLIMITED_RESOURCES:
        return False
    return limit < 0


# ---------------------------------------------------------------------------
# Quota result type
# ---------------------------------------------------------------------------


@dataclass
class QuotaResult:
    """Result of a quota enforcement check.

    Attributes
    ----------
    allowed : bool
        Whether the operation is allowed.
    tenant_id : str
        The tenant identifier.
    tier : str
        Resolved tier name.
    resource : str
        The resource type that was checked (e.g. ``"fixes"``).
    usage : int
        Current usage of the resource.
    limit : int
        Maximum allowed (-1 = unlimited).
    remaining : int
        Remaining capacity (-1 = unlimited).
    blocked_reason : str | None
        If blocked, a human-readable reason with upgrade prompt.
    warning : str | None
        If approaching the limit, a warning message.
    """

    allowed: bool
    tenant_id: str
    tier: str
    resource: str
    usage: int = 0
    limit: int = -1
    remaining: int = -1
    blocked_reason: str | None = None
    warning: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "tenant_id": self.tenant_id,
            "tier": self.tier,
            "resource": self.resource,
            "usage": self.usage,
            "limit": self.limit,
            "remaining": self.remaining,
            "blocked_reason": self.blocked_reason,
            "warning": self.warning,
        }

    def __repr__(self) -> str:
        return (
            f"QuotaResult(allowed={self.allowed}, tenant={self.tenant_id}, "
            f"tier={self.tier}, resource={self.resource}, "
            f"usage={self.usage}/{self.limit})"
        )


# ---------------------------------------------------------------------------
# Upgrade prompts & warnings
# ---------------------------------------------------------------------------

_UPGRADE_PROMPTS: dict[str, str] = {
    "free": (
        "You have reached the Free tier limit for {resource_label} "
        "({usage}/{limit}). Upgrade to Solo ($49/mo) for higher limits, "
        "premium models, and priority support."
    ),
    "solo": (
        "You have reached the Solo plan limit for {resource_label} "
        "({usage}/{limit}). Upgrade to Team ($149/mo) for 500 fixes/mo "
        "with priority support."
    ),
    "team": (
        "You have reached the Team plan limit for {resource_label} "
        "({usage}/{limit}). Contact sales for Enterprise plans "
        "with unlimited capacity."
    ),
}


def _build_upgrade_prompt(tier: str, resource: str, usage: int, limit: int) -> str:
    """Return a human-readable upgrade prompt."""
    label = _RESOURCE_LABELS.get(resource, resource)
    template = _UPGRADE_PROMPTS.get(
        tier,
        "You have reached the plan limit for {resource_label} "
        "({usage}/{limit}). Please upgrade to continue.",
    )
    return template.format(resource_label=label, usage=usage, limit=limit)


def _build_warning(tier: str, resource: str, usage: int, limit: int) -> str:
    """Return a warning when approaching the limit."""
    pct = round(usage / limit * 100)
    label = _RESOURCE_LABELS.get(resource, resource)
    remaining = limit - usage
    return (
        f"You have used {pct}% of your {tier.title()} tier {label} limit "
        f"({usage}/{limit}). Only {remaining} remaining this period. "
        "Upgrade to avoid interruption."
    )


# ---------------------------------------------------------------------------
# Main enforcement check
# ---------------------------------------------------------------------------

_WARN_THRESHOLD = float(os.getenv("QUOTA_WARN_THRESHOLD", "0.8"))  # 80%


def check_quota(
    tenant_id: str,
    resource: str,
    usage: int | None = None,
    tier_override: str | None = None,
) -> QuotaResult:
    """Pre-flight quota enforcement for a tenant on a given resource.

    Steps
    -----
    1. Resolve the tenant's tier.
    2. Look up the tier's limit for the requested resource.
    3. If the limit is -1 (unlimited), allow immediately.
    4. If usage >= limit, block with an upgrade prompt.
    5. If usage >= 80% of limit, allow but set a warning.
    6. Otherwise, allow.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.
    resource : str
        Resource type to check (``"fixes"``, ``"storage"``, ``"workspaces"``,
        ``"api_rate"``).
    usage : int | None
        Current usage count. If ``None``, attempts to read from Redis via
        ``workers.billing.usage.get_usage()``.
    tier_override : str | None
        Explicit tier (skips env-var resolution).

    Returns
    -------
    QuotaResult
        Serializable result.
    """
    tier = resolve_tier(tenant_id, tier_override)
    limit = tier_limit(tier, resource)

    # Unlimited — always allow
    if is_unlimited(limit, resource):
        return QuotaResult(
            allowed=True,
            tenant_id=tenant_id,
            tier=tier,
            resource=resource,
            usage=0,
            limit=-1,
            remaining=-1,
        )

    # Resolve usage
    if usage is None:
        try:
            from workers.billing.usage import get_usage as _get_usage

            data = _get_usage(tenant_id)
            usage = data.get("count", 0)
        except Exception as exc:
            logger.warning(
                "Usage lookup failed for tenant=%s resource=%s — "
                "allowing through: %s",
                tenant_id,
                resource,
                exc,
            )
            return QuotaResult(
                allowed=True,
                tenant_id=tenant_id,
                tier=tier,
                resource=resource,
                usage=0,
                limit=limit,
                remaining=limit,
                warning="Unable to verify usage. Operation will proceed but "
                "may exceed plan limit.",
            )

    remaining = max(0, limit - usage)

    # Block if at or over limit
    if usage >= limit:
        reason = _build_upgrade_prompt(tier, resource, usage, limit)
        logger.info(
            "Quota blocked tenant=%s tier=%s resource=%s usage=%d limit=%d",
            tenant_id,
            tier,
            resource,
            usage,
            limit,
        )
        return QuotaResult(
            allowed=False,
            tenant_id=tenant_id,
            tier=tier,
            resource=resource,
            usage=usage,
            limit=limit,
            remaining=0,
            blocked_reason=reason,
        )

    # Warn at threshold
    warning: str | None = None
    if usage >= int(limit * _WARN_THRESHOLD):
        warning = _build_warning(tier, resource, usage, limit)
        logger.info(
            "Quota warning tenant=%s tier=%s resource=%s usage=%d "
            "limit=%d threshold=%.0f%%",
            tenant_id,
            tier,
            resource,
            usage,
            limit,
            _WARN_THRESHOLD * 100,
        )

    return QuotaResult(
        allowed=True,
        tenant_id=tenant_id,
        tier=tier,
        resource=resource,
        usage=usage,
        limit=limit,
        remaining=remaining,
        warning=warning,
    )
