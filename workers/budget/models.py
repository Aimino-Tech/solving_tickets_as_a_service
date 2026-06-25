"""
Budget model types — dataclasses and enums for per-tenant token/cost budget.

── Design ───────────────────────────────────────────────────────────────────
- ``Budget`` holds the full per-tenant budget state including caps, usage, and
  billing period metadata. Serialisable to/from dict for Redis persistence.
- ``BudgetStatus`` enum tracks whether the budget is active, in warning,
  exceeded, or has been reset.
- ``BudgetCheckResult`` is the return type of the enforcer — callers use
  ``allowed`` to decide if a task should proceed.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional


class BudgetStatus(enum.Enum):
    """
    Budget lifecycle status.

    ACTIVE   — Budget is within limits, usage is below caps.
    WARNING  — Usage has crossed the warning threshold (default 80%).
    EXCEEDED — Usage has hit or exceeded one or both caps.
    RESET    — Budget has been reset for a new billing period.
    """

    ACTIVE = "active"
    WARNING = "warning"
    EXCEEDED = "exceeded"
    RESET = "reset"

    def __str__(self) -> str:
        return self.value


@dataclass
class Budget:
    """
    Per-tenant monthly cost budget state.

    Attributes
    ----------
    tenant_id : str
        The tenant identifier (e.g. account UUID or Stripe customer ID).
    monthly_token_cap : int
        Maximum number of tokens allowed per billing period (-1 = unlimited).
    monthly_cost_cap : int
        Maximum cost in **cents** (USD) allowed per billing period (-1 = unlimited).
    tokens_used : int
        Total tokens consumed in the current billing period.
    cost_incurred : int
        Total cost incurred in **cents** in the current billing period.
    status : BudgetStatus
        Current budget status (ACTIVE / WARNING / EXCEEDED / RESET).
    reset_at : str | None
        ISO-8601 timestamp of the last reset (start of current billing period).
    period_start : str | None
        ISO-8601 timestamp of the current billing period start.
    """

    tenant_id: str
    monthly_token_cap: int = -1
    monthly_cost_cap: int = -1
    tokens_used: int = 0
    cost_incurred: int = 0
    status: BudgetStatus = BudgetStatus.ACTIVE
    reset_at: str | None = None
    period_start: str | None = None

    def token_remaining(self) -> int:
        """Return remaining tokens for this period (-1 = unlimited)."""
        if self.monthly_token_cap < 0:
            return -1
        return max(0, self.monthly_token_cap - self.tokens_used)

    def cost_remaining(self) -> int:
        """Return remaining cost in cents (-1 = unlimited)."""
        if self.monthly_cost_cap < 0:
            return -1
        return max(0, self.monthly_cost_cap - self.cost_incurred)

    def token_usage_pct(self) -> float:
        """Return token usage as a fraction of cap (0.0 if unlimited)."""
        if self.monthly_token_cap <= 0:
            return 0.0
        return self.tokens_used / self.monthly_token_cap

    def cost_usage_pct(self) -> float:
        """Return cost usage as a fraction of cap (0.0 if unlimited)."""
        if self.monthly_cost_cap <= 0:
            return 0.0
        return self.cost_incurred / self.monthly_cost_cap

    def combined_usage_pct(self) -> float:
        """Return the higher of token and cost usage percentage."""
        return max(self.token_usage_pct(), self.cost_usage_pct())

    def is_unlimited(self) -> bool:
        """Return True if both caps are unlimited (-1)."""
        return self.monthly_token_cap < 0 and self.monthly_cost_cap < 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Budget:
        status_raw = data.get("status", "active")
        if isinstance(status_raw, BudgetStatus):
            status = status_raw
        else:
            try:
                status = BudgetStatus(status_raw)
            except ValueError:
                status = BudgetStatus.ACTIVE

        # Redis stores integers as strings — coerce to int
        def _int(val: Any, default: int = 0) -> int:
            if isinstance(val, int):
                return val
            if isinstance(val, str):
                try:
                    return int(val)
                except (ValueError, TypeError):
                    return default
            return default

        return Budget(
            tenant_id=data["tenant_id"],
            monthly_token_cap=_int(data.get("monthly_token_cap"), -1),
            monthly_cost_cap=_int(data.get("monthly_cost_cap"), -1),
            tokens_used=_int(data.get("tokens_used"), 0),
            cost_incurred=_int(data.get("cost_incurred"), 0),
            status=status,
            reset_at=data.get("reset_at"),
            period_start=data.get("period_start"),
        )

    def __repr__(self) -> str:
        return (
            f"Budget(tenant={self.tenant_id}, tokens={self.tokens_used}/"
            f"{self.monthly_token_cap}, cost={self.cost_incurred}/"
            f"{self.monthly_cost_cap}, status={self.status.value})"
        )


@dataclass
class BudgetCheckResult:
    """
    Result of a pre-dispatch budget enforcement check.

    Attributes
    ----------
    allowed : bool
        Whether the task is allowed to proceed.
    tenant_id : str
        The tenant identifier.
    budget : Budget | None
        The current budget state, or None if lookup failed.
    blocked_reason : str | None
        If blocked, a human-readable reason (with upgrade prompt).
    warning : str | None
        If at warning threshold, a human-readable warning message.
    """

    allowed: bool
    tenant_id: str
    budget: Budget | None = None
    blocked_reason: str | None = None
    warning: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "tenant_id": self.tenant_id,
            "budget": self.budget.to_dict() if self.budget else None,
            "blocked_reason": self.blocked_reason,
            "warning": self.warning,
        }

    def __repr__(self) -> str:
        return (
            f"BudgetCheckResult(allowed={self.allowed}, tenant={self.tenant_id}, "
            f"blocked={self.blocked_reason is not None})"
        )


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()
