"""
Budget enforcement gate — check tenant usage against token/cost caps before dispatch.

Provides the pre-flight check that decides whether a tenant can run a fix
based on their monthly token and cost budget.

── Design ───────────────────────────────────────────────────────────────────
- ``check_budget()`` is the main entry point: it reads the tenant's current
  budget from Redis (via ``workers.budget.tracker``), compares usage against
  caps, and returns a ``BudgetCheckResult``.
- At 80% of either cap, a warning flag is set.
- At 100% (or above) of either cap, the fix is blocked.
- If both caps are -1 (unlimited), the check always passes.
- If the budget record does not exist, the check passes (fail-open for
  tenants not yet on budget tracking).

── Error Handling ──────────────────────────────────────────────────────────
- If Redis is unavailable, the gate allows the fix through (fail-open) and
  logs a warning.
- Unknown tenant IDs (no budget record) are treated as unlimited — allowed.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
from typing import Optional

from workers.budget.models import Budget, BudgetCheckResult, BudgetStatus
from workers.budget.tracker import get_budget

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default thresholds
# ---------------------------------------------------------------------------

_WARN_THRESHOLD = 0.8  # 80%


# ---------------------------------------------------------------------------
# Main enforcement check
# ---------------------------------------------------------------------------


def check_budget(tenant_id: str) -> BudgetCheckResult:
    """
    Pre-flight check: can this tenant run a fix within their budget?

    Steps:
    1. Load the tenant's current budget from Redis.
    2. If no budget record exists → allow (fail-open for non-tracked tenants).
    3. If the budget is unlimited (both caps -1) → allow immediately.
    4. If status is EXCEEDED → block with upgrade prompt.
    5. If combined usage >= 80% of either cap → allow but set warning.
    6. Otherwise → allow.

    Parameters
    ----------
    tenant_id : str
        The tenant identifier.

    Returns
    -------
    BudgetCheckResult
        Serializable result with ``allowed``, ``blocked_reason``, ``warning``.
    """
    # Load budget
    budget: Optional[Budget] = None
    try:
        budget = get_budget(tenant_id)
    except Exception as exc:
        logger.warning(
            "Budget lookup failed for tenant=%s — allowing through: %s",
            tenant_id,
            exc,
        )
        return BudgetCheckResult(
            allowed=True,
            tenant_id=tenant_id,
            budget=None,
            warning="Unable to verify budget. Fix will proceed but may exceed budget limits.",
        )

    # No budget record → allow (tenant is not on budget tracking yet)
    if budget is None:
        logger.debug("No budget record for tenant=%s — allowing through", tenant_id)
        return BudgetCheckResult(allowed=True, tenant_id=tenant_id, budget=None)

    # Unlimited budget → always allow
    if budget.is_unlimited():
        return BudgetCheckResult(allowed=True, tenant_id=tenant_id, budget=budget)

    # Already exceeded → block
    if budget.status == BudgetStatus.EXCEEDED:
        reason = _build_blocked_reason(budget)
        logger.info(
            "Budget exceeded tenant=%s tokens=%d/%d cost=%d/%d",
            tenant_id,
            budget.tokens_used,
            budget.monthly_token_cap,
            budget.cost_incurred,
            budget.monthly_cost_cap,
        )
        return BudgetCheckResult(
            allowed=False,
            tenant_id=tenant_id,
            budget=budget,
            blocked_reason=reason,
        )

    # Check if at or over cap (defensive — status might not have caught this)
    if _is_over_cap(budget):
        reason = _build_blocked_reason(budget)
        logger.info(
            "Budget over cap tenant=%s tokens=%d/%d cost=%d/%d",
            tenant_id,
            budget.tokens_used,
            budget.monthly_token_cap,
            budget.cost_incurred,
            budget.monthly_cost_cap,
        )
        return BudgetCheckResult(
            allowed=False,
            tenant_id=tenant_id,
            budget=budget,
            blocked_reason=reason,
        )

    # Check warning threshold
    warning: str | None = None
    usage_pct = budget.combined_usage_pct()
    if usage_pct >= _WARN_THRESHOLD:
        warning = _build_warning(budget)
        logger.info(
            "Budget warning tenant=%s usage=%.0f%% tokens=%d/%d cost=%d/%d",
            tenant_id,
            usage_pct * 100,
            budget.tokens_used,
            budget.monthly_token_cap,
            budget.cost_incurred,
            budget.monthly_cost_cap,
        )

    return BudgetCheckResult(
        allowed=True,
        tenant_id=tenant_id,
        budget=budget,
        warning=warning,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_over_cap(budget: Budget) -> bool:
    """Check if usage exceeds either cap."""
    if budget.monthly_token_cap >= 0 and budget.tokens_used >= budget.monthly_token_cap:
        return True
    if budget.monthly_cost_cap >= 0 and budget.cost_incurred >= budget.monthly_cost_cap:
        return True
    return False


def _build_blocked_reason(budget: Budget) -> str:
    """Return a human-readable blocked reason."""
    parts: list[str] = []
    if budget.monthly_token_cap >= 0 and budget.tokens_used >= budget.monthly_token_cap:
        parts.append(f"token cap of {_format_tokens(budget.monthly_token_cap)} reached")
    if budget.monthly_cost_cap >= 0 and budget.cost_incurred >= budget.monthly_cost_cap:
        parts.append(f"cost cap of {_format_cost(budget.monthly_cost_cap)} reached")

    if parts:
        detail = " and ".join(parts)
        return (
            f"Your monthly budget has been exceeded ({detail}). "
            "Please wait for the next billing cycle or contact support to increase your limits."
        )

    return (
        "Your monthly budget has been exceeded. "
        "Please wait for the next billing cycle or contact support to increase your limits."
    )


def _build_warning(budget: Budget) -> str:
    """Return a warning message when approaching the budget limit."""
    token_pct = budget.token_usage_pct()
    cost_pct = budget.cost_usage_pct()
    pct = max(token_pct, cost_pct) * 100

    details: list[str] = []
    if token_pct >= _WARN_THRESHOLD:
        remaining_tokens = budget.token_remaining()
        details.append(
            f"tokens: {_format_tokens(remaining_tokens)} remaining"
        )
    if cost_pct >= _WARN_THRESHOLD:
        remaining_cost = budget.cost_remaining()
        details.append(
            f"cost: {_format_cost(remaining_cost)} remaining"
        )

    detail_str = ", ".join(details)
    return (
        f"You have used {pct:.0f}% of your monthly budget ({detail_str}). "
        "Reduce usage or upgrade to avoid interruptions."
    )


def _format_tokens(count: int) -> str:
    """Format token count for display (e.g. '1.5M', '500K')."""
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    if count >= 1_000:
        return f"{count / 1_000:.0f}K"
    return str(count)


def _format_cost(cents: int) -> str:
    """Format cost in cents for display (e.g. '$12.50')."""
    if cents <= 0:
        return "$0.00"
    return f"${cents / 100:.2f}"
