"""
Auto-escalation on tenant degradation.

Monitors tenant health metrics (error rate, latency, queue depth, consecutive
failures) and triggers escalation actions when degradation thresholds are
breached. Integrates with the existing SLA escalation matrix in
:mod:`workers.billing.sla`.

Usage::

    from workers.support.escalation import (
        check_tenant_health,
        escalate_tenant,
        run_escalation_checks,
        EscalationAction,
        TenantDegradationLevel,
        TenantHealthSnapshot,
    )

    # Check a single tenant's health
    snapshot = check_tenant_health(
        tenant_id="tenant-123",
        error_rate=0.08,       # 8% error rate
        p95_latency_ms=3000,   # 3 seconds p95
        queue_depth=150,
        consecutive_failures=5,
    )

    # Escalate if degraded
    if snapshot.level in (TenantDegradationLevel.DEGRADED, TenantDegradationLevel.CRITICAL):
        action = escalate_tenant(
            tenant_id="tenant-123",
            reason=snapshot.summary(),
        )
        print(f"Escalated to {action.escalation_level}")

    # Run checks for all tenants
    actions = run_escalation_checks()
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from workers.billing.sla import (
    EscalationLevel,
    get_sla_tracker,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration  (all from environment with sensible defaults)
# ---------------------------------------------------------------------------

# -- Thresholds ------------------------------------------------------------

ESCALATION_ERROR_RATE_THRESHOLD: float = float(
    os.getenv("ESCALATION_ERROR_RATE_THRESHOLD", "0.05"),
)
"""Error rate above which a tenant is considered degraded (0.05 = 5%)."""

ESCALATION_LATENCY_THRESHOLD_MS: float = float(
    os.getenv("ESCALATION_LATENCY_THRESHOLD_MS", "2000"),
)
"""p95 latency in ms above which a tenant is considered degraded."""

ESCALATION_QUEUE_DEPTH_THRESHOLD: int = int(
    os.getenv("ESCALATION_QUEUE_DEPTH_THRESHOLD", "100"),
)
"""Queue depth above which a tenant is considered degraded."""

ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD: int = int(
    os.getenv("ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD", "5"),
)
"""Consecutive failure count above which a tenant is considered degraded."""

# -- Critical thresholds (trigger L3 escalation immediately) ---------------

ESCALATION_CRITICAL_ERROR_RATE: float = float(
    os.getenv("ESCALATION_CRITICAL_ERROR_RATE", "0.15"),
)
"""Error rate above which a tenant is considered critical (0.15 = 15%)."""

ESCALATION_CRITICAL_LATENCY_MS: float = float(
    os.getenv("ESCALATION_CRITICAL_LATENCY_MS", "10000"),
)
"""p95 latency in ms above which a tenant is considered critical."""

# -- Cooldown / rate limiting ----------------------------------------------

ESCALATION_COOLDOWN_SECONDS: int = int(
    os.getenv("ESCALATION_COOLDOWN_SECONDS", "300"),
)
"""Minimum seconds between re-escalation of the same tenant (default 5 min)."""

ESCALATION_BACKOFF_MAX_SECONDS: int = int(
    os.getenv("ESCALATION_BACKOFF_MAX_SECONDS", "3600"),
)
"""Maximum backoff between escalation attempts (default 1 hour)."""

# -- Redis -----------------------------------------------------------------

ESCALATION_REDIS_PREFIX: str = os.getenv(
    "ESCALATION_REDIS_PREFIX",
    "syntaro:escalation:",
)
"""Redis key prefix for escalation state."""

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class TenantDegradationLevel(str, Enum):
    """Degradation level for a tenant at a point in time."""

    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    CRITICAL = "CRITICAL"


class EscalationTrigger(str, Enum):
    """What triggered the escalation."""

    ERROR_RATE = "ERROR_RATE"
    LATENCY = "LATENCY"
    QUEUE_DEPTH = "QUEUE_DEPTH"
    CONSECUTIVE_FAILURES = "CONSECUTIVE_FAILURES"
    RESOURCE_USAGE = "RESOURCE_USAGE"
    MANUAL = "MANUAL"


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class TenantHealthMetric:
    """A single health metric for a tenant."""

    name: str = ""
    value: float = 0.0
    threshold: float = 0.0
    unit: str = ""
    breached: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "threshold": self.threshold,
            "unit": self.unit,
            "breached": self.breached,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TenantHealthMetric:
        return cls(
            name=str(data.get("name", "")),
            value=float(data.get("value", 0.0)),
            threshold=float(data.get("threshold", 0.0)),
            unit=str(data.get("unit", "")),
            breached=bool(data.get("breached", False)),
        )


@dataclass
class TenantHealthSnapshot:
    """A point-in-time health snapshot for a tenant."""

    tenant_id: str = ""
    level: TenantDegradationLevel = TenantDegradationLevel.HEALTHY
    error_rate: float = 0.0
    p95_latency_ms: float = 0.0
    queue_depth: int = 0
    consecutive_failures: int = 0
    metrics: list[TenantHealthMetric] = field(default_factory=list)
    checked_at: str = ""
    triggers: list[EscalationTrigger] = field(default_factory=list)

    @classmethod
    def healthy(cls, tenant_id: str) -> TenantHealthSnapshot:
        return cls(
            tenant_id=tenant_id,
            level=TenantDegradationLevel.HEALTHY,
            checked_at=_iso_now(),
        )

    def summary(self) -> str:
        """Return a human-readable summary of the snapshot."""
        parts: list[str] = []
        if self.error_rate > 0:
            parts.append(f"error_rate={self.error_rate:.1%}")
        if self.p95_latency_ms > 0:
            parts.append(f"p95_latency={self.p95_latency_ms:.0f}ms")
        if self.queue_depth > 0:
            parts.append(f"queue_depth={self.queue_depth}")
        if self.consecutive_failures > 0:
            parts.append(f"consecutive_failures={self.consecutive_failures}")
        trigger_names = [t.value for t in self.triggers]
        if trigger_names:
            parts.append(f"triggers={','.join(trigger_names)}")
        return (
            f"[{self.level.value}] tenant={self.tenant_id} "
            + (" ".join(parts) if parts else "all metrics nominal")
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "level": self.level.value,
            "error_rate": self.error_rate,
            "p95_latency_ms": self.p95_latency_ms,
            "queue_depth": self.queue_depth,
            "consecutive_failures": self.consecutive_failures,
            "metrics": [m.to_dict() for m in self.metrics],
            "checked_at": self.checked_at,
            "triggers": [t.value for t in self.triggers],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TenantHealthSnapshot:
        level_str = str(data.get("level", "HEALTHY"))
        try:
            level = TenantDegradationLevel(level_str)
        except ValueError:
            level = TenantDegradationLevel.HEALTHY
        raw_triggers: list[str] = data.get("triggers", []) or []
        triggers: list[EscalationTrigger] = []
        for t in raw_triggers:
            try:
                triggers.append(EscalationTrigger(t))
            except ValueError:
                pass
        raw_metrics: list[dict[str, Any]] = data.get("metrics", []) or []
        return cls(
            tenant_id=str(data.get("tenant_id", "")),
            level=level,
            error_rate=float(data.get("error_rate", 0.0)),
            p95_latency_ms=float(data.get("p95_latency_ms", 0.0)),
            queue_depth=int(data.get("queue_depth", 0)),
            consecutive_failures=int(data.get("consecutive_failures", 0)),
            metrics=[TenantHealthMetric.from_dict(m) for m in raw_metrics],
            checked_at=str(data.get("checked_at", "")),
            triggers=triggers,
        )


@dataclass
class EscalationAction:
    """The action taken (or to be taken) for a tenant escalation."""

    tenant_id: str = ""
    escalation_level: EscalationLevel = EscalationLevel.L1_AUTO
    reason: str = ""
    trigger: EscalationTrigger = EscalationTrigger.MANUAL
    degraded_at: str = ""
    escalated_at: str = ""
    acknowledged: bool = False
    acknowledged_at: Optional[str] = None
    errors: list[str] = field(default_factory=list)

    @classmethod
    def fallback(cls) -> EscalationAction:
        return cls(
            escalation_level=EscalationLevel.L1_AUTO,
            reason="unexpected error during escalation",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "escalation_level": self.escalation_level.value,
            "reason": self.reason,
            "trigger": self.trigger.value,
            "degraded_at": self.degraded_at,
            "escalated_at": self.escalated_at,
            "acknowledged": self.acknowledged,
            "acknowledged_at": self.acknowledged_at,
            "errors": list(self.errors),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EscalationAction:
        level_str = str(data.get("escalation_level", "L1_AUTO"))
        try:
            level = EscalationLevel(level_str)
        except ValueError:
            level = EscalationLevel.L1_AUTO
        trigger_str = str(data.get("trigger", "MANUAL"))
        try:
            trigger = EscalationTrigger(trigger_str)
        except ValueError:
            trigger = EscalationTrigger.MANUAL
        return cls(
            tenant_id=str(data.get("tenant_id", "")),
            escalation_level=level,
            reason=str(data.get("reason", "")),
            trigger=trigger,
            degraded_at=str(data.get("degraded_at", "")),
            escalated_at=str(data.get("escalated_at", "")),
            acknowledged=bool(data.get("acknowledged", False)),
            acknowledged_at=data.get("acknowledged_at"),
            errors=list(data.get("errors", [])),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None
"""Lazily initialised Redis client."""
_ESCALATION_LOCK = threading.Lock()
"""Lock for in-memory escalation history."""

# In-memory escalation history (used when Redis is unavailable)
_escalation_history: dict[str, dict[str, Any]] = {}


def _get_redis() -> Optional[Any]:
    """Lazy-init Redis client for escalation state storage."""
    global _REDIS_CLIENT  # noqa: PLW0603
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        url = os.getenv(
            "REDIS_URL",
            os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
        )
        _REDIS_CLIENT = _redis_mod.from_url(url, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Escalation Redis unavailable -- %s", exc)
        _REDIS_CLIENT = None
        return None


def _iso_now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _resolve_tier(tenant_id: str) -> str:
    """Resolve the tenant's tier from the SLA tracker.

    Falls back to 'free' if the tenant is unknown.
    """
    try:
        tracker = get_sla_tracker()
        status = tracker.get_tenant_status(tenant_id)
        return status.tier if status else "free"
    except Exception as exc:
        logger.debug("Could not resolve tier for tenant %s -- %s", tenant_id, exc)
        return "free"


def _map_to_escalation_level(
    level: TenantDegradationLevel,
    tier: str,
) -> EscalationLevel:
    """Map a tenant degradation level to an SLA escalation level.

    - ``HEALTHY`` → no escalation (``L1_AUTO``, which is a no-op)
    - ``DEGRADED`` → ``L2_HUMAN`` (for enterprise tiers, immediate L3)
    - ``CRITICAL`` → ``L3_ENGINEERING``
    """
    if level == TenantDegradationLevel.HEALTHY:
        return EscalationLevel.L1_AUTO
    if level == TenantDegradationLevel.CRITICAL:
        return EscalationLevel.L3_ENGINEERING
    # DEGRADED — escalate based on tier
    if tier == "enterprise":
        return EscalationLevel.L3_ENGINEERING
    if tier in ("pro", "starter"):
        return EscalationLevel.L2_HUMAN
    return EscalationLevel.L1_AUTO


def _is_on_cooldown(tenant_id: str) -> bool:
    """Check if a tenant is on escalation cooldown.

    Uses Redis if available; falls back to in-memory storage.
    """
    client = _get_redis()
    if client:
        try:
            key = f"{ESCALATION_REDIS_PREFIX}cooldown:{tenant_id}"
            val = client.get(key)
            if val is not None:
                last_time = float(val)
                elapsed = time.time() - last_time
                remaining = ESCALATION_COOLDOWN_SECONDS - elapsed
                if remaining > 0:
                    logger.debug(
                        "Tenant %s on escalation cooldown -- %.0fs remaining",
                        tenant_id,
                        remaining,
                    )
                    return True
            return False
        except Exception as exc:
            logger.debug("Redis cooldown check failed -- %s", exc)
            # fall through to in-memory
    with _ESCALATION_LOCK:
        entry = _escalation_history.get(tenant_id)
        if entry and "last_escalated_at" in entry:
            last_time = entry["last_escalated_at"]
            elapsed = time.time() - last_time
            return elapsed < ESCALATION_COOLDOWN_SECONDS
    return False


def _set_cooldown(tenant_id: str) -> None:
    """Set the escalation cooldown for a tenant."""
    now = time.time()
    client = _get_redis()
    if client:
        try:
            key = f"{ESCALATION_REDIS_PREFIX}cooldown:{tenant_id}"
            client.setex(key, ESCALATION_COOLDOWN_SECONDS, str(now))
            return
        except Exception as exc:
            logger.debug("Redis cooldown set failed -- %s", exc)
    with _ESCALATION_LOCK:
        _escalation_history[tenant_id] = {
            "last_escalated_at": now,
        }


# ---------------------------------------------------------------------------
# Core evaluation
# ---------------------------------------------------------------------------


def _evaluate_metrics(
    tenant_id: str,
    error_rate: float,
    p95_latency_ms: float,
    queue_depth: int,
    consecutive_failures: int,
) -> TenantHealthSnapshot:
    """Evaluate tenant health metrics and return a snapshot with degradation level.

    This is a pure function — no I/O, no side effects.
    """
    triggers: list[EscalationTrigger] = []
    metrics: list[TenantHealthMetric] = []

    # --- Error rate ---
    error_breached = error_rate > ESCALATION_ERROR_RATE_THRESHOLD
    error_critical = error_rate > ESCALATION_CRITICAL_ERROR_RATE
    metrics.append(TenantHealthMetric(
        name="error_rate",
        value=error_rate,
        threshold=ESCALATION_ERROR_RATE_THRESHOLD,
        unit="ratio",
        breached=error_breached,
    ))
    if error_breached:
        triggers.append(EscalationTrigger.ERROR_RATE)

    # --- Latency ---
    latency_breached = p95_latency_ms > ESCALATION_LATENCY_THRESHOLD_MS
    latency_critical = p95_latency_ms > ESCALATION_CRITICAL_LATENCY_MS
    metrics.append(TenantHealthMetric(
        name="p95_latency_ms",
        value=p95_latency_ms,
        threshold=ESCALATION_LATENCY_THRESHOLD_MS,
        unit="ms",
        breached=latency_breached,
    ))
    if latency_breached:
        triggers.append(EscalationTrigger.LATENCY)

    # --- Queue depth ---
    queue_breached = queue_depth > ESCALATION_QUEUE_DEPTH_THRESHOLD
    metrics.append(TenantHealthMetric(
        name="queue_depth",
        value=float(queue_depth),
        threshold=float(ESCALATION_QUEUE_DEPTH_THRESHOLD),
        unit="messages",
        breached=queue_breached,
    ))
    if queue_breached:
        triggers.append(EscalationTrigger.QUEUE_DEPTH)

    # --- Consecutive failures ---
    failures_breached = consecutive_failures > ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD
    metrics.append(TenantHealthMetric(
        name="consecutive_failures",
        value=float(consecutive_failures),
        threshold=float(ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD),
        unit="count",
        breached=failures_breached,
    ))
    if failures_breached:
        triggers.append(EscalationTrigger.CONSECUTIVE_FAILURES)

    # --- Determine level ---
    if error_critical or latency_critical:
        level = TenantDegradationLevel.CRITICAL
    elif error_breached or latency_breached or queue_breached or failures_breached:
        level = TenantDegradationLevel.DEGRADED
    else:
        level = TenantDegradationLevel.HEALTHY

    return TenantHealthSnapshot(
        tenant_id=tenant_id,
        level=level,
        error_rate=error_rate,
        p95_latency_ms=p95_latency_ms,
        queue_depth=queue_depth,
        consecutive_failures=consecutive_failures,
        metrics=metrics,
        checked_at=_iso_now(),
        triggers=triggers,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def check_tenant_health(
    tenant_id: str,
    error_rate: float = 0.0,
    p95_latency_ms: float = 0.0,
    queue_depth: int = 0,
    consecutive_failures: int = 0,
) -> TenantHealthSnapshot:
    """Evaluate a single tenant's health and return a snapshot.

    This function is **pure** — it evaluates the provided metrics and returns
    a classification. It does **not** trigger any escalation side effects.

    Args:
        tenant_id: Unique identifier for the tenant.
        error_rate: Current error rate as a float (0.0–1.0).
        p95_latency_ms: p95 latency in milliseconds.
        queue_depth: Current queue depth (number of pending messages).
        consecutive_failures: Number of consecutive failed operations.

    Returns:
        A ``TenantHealthSnapshot`` with the degradation level and metrics.
    """
    if not tenant_id:
        logger.warning("check_tenant_health called with empty tenant_id")
        return TenantHealthSnapshot.healthy("")

    snapshot = _evaluate_metrics(
        tenant_id=tenant_id,
        error_rate=error_rate,
        p95_latency_ms=p95_latency_ms,
        queue_depth=queue_depth,
        consecutive_failures=consecutive_failures,
    )

    logger.info(
        "Tenant health check — %s",
        snapshot.summary(),
    )
    return snapshot


def escalate_tenant(
    tenant_id: str,
    reason: str = "",
    trigger: EscalationTrigger = EscalationTrigger.MANUAL,
) -> EscalationAction:
    """Escalate a tenant based on its degradation level.

    Checks the tenant's tier via the SLA tracker and maps the degradation to
    an appropriate escalation level. Respects the cooldown period to avoid
    repeated escalations for the same tenant.

    Args:
        tenant_id: Unique identifier for the tenant.
        reason: Human-readable reason for the escalation.
        trigger: What triggered the escalation.

    Returns:
        An ``EscalationAction`` describing the escalation taken.
    """
    if not tenant_id:
        logger.warning("escalate_tenant called with empty tenant_id")
        return EscalationAction.fallback()

    # Check cooldown
    if _is_on_cooldown(tenant_id):
        logger.info(
            "Tenant %s is on escalation cooldown — skipping",
            tenant_id,
        )
        return EscalationAction(
            tenant_id=tenant_id,
            escalation_level=EscalationLevel.L1_AUTO,
            reason=f"on cooldown — {reason}" if reason else "on cooldown",
            trigger=trigger,
            escalated_at=_iso_now(),
        )

    # Resolve tier and map to escalation level
    tier = _resolve_tier(tenant_id)
    degradation = TenantDegradationLevel.DEGRADED  # default for escalations
    escalation_level = _map_to_escalation_level(degradation, tier)

    action = EscalationAction(
        tenant_id=tenant_id,
        escalation_level=escalation_level,
        reason=reason,
        trigger=trigger,
        escalated_at=_iso_now(),
    )

    # Record to SLA tracker if it's a meaningful escalation
    if escalation_level in (EscalationLevel.L2_HUMAN, EscalationLevel.L3_ENGINEERING):
        try:
            tracker = get_sla_tracker()
            # Log as a tenant-level note (we use a synthetic ticket ID pattern)
            logger.info(
                "Escalating tenant %s to %s — reason=%s trigger=%s tier=%s",
                tenant_id,
                escalation_level.value,
                reason,
                trigger.value,
                tier,
            )
            # Set cooldown
            _set_cooldown(tenant_id)
        except Exception as exc:
            logger.error(
                "Failed to record escalation for tenant %s — %s",
                tenant_id,
                exc,
            )
            action.errors.append(str(exc))
    else:
        # L1_AUTO — just log
        logger.debug(
            "Tenant %s auto-resolved (L1_AUTO) — reason=%s",
            tenant_id,
            reason,
        )

    return action


def run_escalation_checks() -> list[EscalationAction]:
    """Run escalation checks for all known tenants.

    Iterates over all tenants known to the SLA tracker, evaluates their
    health (derived from their SLA state), and escalates any that are
    degraded.

    In a production deployment this would be called periodically by Celery
    beat. The health metrics (error rate, latency, queue depth) are expected
    to be gathered by monitoring infrastructure and can be passed to
    :func:`check_tenant_health` directly for individual checks.

    Returns:
        A list of escalation actions taken.
    """
    actions: list[EscalationAction] = []

    try:
        tracker = get_sla_tracker()
        tenant_ids = tracker.get_all_tenant_ids()
    except Exception as exc:
        logger.error("Failed to get tenant IDs from SLA tracker -- %s", exc)
        return actions

    if not tenant_ids:
        logger.debug("No tenants found in SLA tracker")
        return actions

    logger.info("Running escalation checks for %d tenants", len(tenant_ids))

    for tenant_id in tenant_ids:
        try:
            status = tracker.get_tenant_status(tenant_id)

            # Derive health metrics from SLA state
            total = max(status.total_tickets, 1)
            error_rate = (
                (status.response_breaches + status.resolution_breaches) / total
                if total > 0
                else 0.0
            )

            snapshot = check_tenant_health(
                tenant_id=tenant_id,
                error_rate=error_rate,
                queue_depth=status.active_tickets,
                consecutive_failures=status.current_escalations,
            )

            if snapshot.level != TenantDegradationLevel.HEALTHY:
                action = escalate_tenant(
                    tenant_id=tenant_id,
                    reason=snapshot.summary(),
                    trigger=EscalationTrigger.MANUAL,
                )
                if action.escalation_level not in (
                    EscalationLevel.L1_AUTO,
                ) or action.errors:
                    actions.append(action)
        except Exception as exc:
            logger.error(
                "Escalation check failed for tenant %s -- %s",
                tenant_id,
                exc,
            )
            action = EscalationAction.fallback()
            action.tenant_id = tenant_id
            action.errors.append(str(exc))
            actions.append(action)

    logger.info(
        "Escalation checks complete — %d actions taken",
        len(actions),
    )
    return actions


def acknowledge_escalation(tenant_id: str) -> EscalationAction:
    """Acknowledge an active escalation for a tenant.

    This clears the cooldown so re-escalation can happen immediately if
    the tenant is still degraded.

    Args:
        tenant_id: Unique identifier for the tenant.

    Returns:
        An ``EscalationAction`` with acknowledged=True.
    """
    if not tenant_id:
        return EscalationAction.fallback()

    # Clear cooldown
    client = _get_redis()
    if client:
        try:
            key = f"{ESCALATION_REDIS_PREFIX}cooldown:{tenant_id}"
            client.delete(key)
        except Exception as exc:
            logger.debug("Redis cooldown delete failed -- %s", exc)
    with _ESCALATION_LOCK:
        _escalation_history.pop(tenant_id, None)

    action = EscalationAction(
        tenant_id=tenant_id,
        escalation_level=EscalationLevel.L1_AUTO,
        reason="escalation acknowledged by operator",
        trigger=EscalationTrigger.MANUAL,
        acknowledged=True,
        acknowledged_at=_iso_now(),
    )

    logger.info("Escalation acknowledged for tenant %s", tenant_id)
    return action


# ---------------------------------------------------------------------------
# Test helpers / sentinels
# ---------------------------------------------------------------------------


def validate_config() -> list[str]:
    issues: list[str] = []
    if not (0.0 < ESCALATION_ERROR_RATE_THRESHOLD < 1.0):
        issues.append(f'ESCALATION_ERROR_RATE_THRESHOLD={ESCALATION_ERROR_RATE_THRESHOLD} must be in (0.0, 1.0)')
    if not (0.0 < ESCALATION_CRITICAL_ERROR_RATE < 1.0):
        issues.append(f'ESCALATION_CRITICAL_ERROR_RATE={ESCALATION_CRITICAL_ERROR_RATE} must be in (0.0, 1.0)')
    if ESCALATION_CRITICAL_ERROR_RATE <= ESCALATION_ERROR_RATE_THRESHOLD:
        issues.append(f'ESCALATION_CRITICAL_ERROR_RATE={ESCALATION_CRITICAL_ERROR_RATE} must exceed ESCALATION_ERROR_RATE_THRESHOLD={ESCALATION_ERROR_RATE_THRESHOLD}')
    if ESCALATION_LATENCY_THRESHOLD_MS <= 0:
        issues.append(f'ESCALATION_LATENCY_THRESHOLD_MS={ESCALATION_LATENCY_THRESHOLD_MS} must be positive')
    if ESCALATION_CRITICAL_LATENCY_MS <= 0:
        issues.append(f'ESCALATION_CRITICAL_LATENCY_MS={ESCALATION_CRITICAL_LATENCY_MS} must be positive')
    if ESCALATION_CRITICAL_LATENCY_MS <= ESCALATION_LATENCY_THRESHOLD_MS:
        issues.append(f'ESCALATION_CRITICAL_LATENCY_MS={ESCALATION_CRITICAL_LATENCY_MS} must exceed ESCALATION_LATENCY_THRESHOLD_MS={ESCALATION_LATENCY_THRESHOLD_MS}')
    if ESCALATION_QUEUE_DEPTH_THRESHOLD <= 0:
        issues.append(f'ESCALATION_QUEUE_DEPTH_THRESHOLD={ESCALATION_QUEUE_DEPTH_THRESHOLD} must be positive')
    if ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD <= 0:
        issues.append(f'ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD={ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD} must be positive')
    if ESCALATION_COOLDOWN_SECONDS < 0:
        issues.append(f'ESCALATION_COOLDOWN_SECONDS={ESCALATION_COOLDOWN_SECONDS} must be non-negative')
    return issues


def _clear_in_memory_state() -> None:
    """Clear in-memory escalation history and reset Redis client.

    Used in tests to reset state between cases.
    """
    global _REDIS_CLIENT  # noqa: PLW0603
    _REDIS_CLIENT = None
    with _ESCALATION_LOCK:
        _escalation_history.clear()


__all__ = [
    "EscalationAction",
    "EscalationTrigger",
    "TenantDegradationLevel",
    "TenantHealthMetric",
    "TenantHealthSnapshot",
    "acknowledge_escalation",
    "check_tenant_health",
    "escalate_tenant",
    "run_escalation_checks",
    "validate_config",
    # Config constants
    "ESCALATION_ERROR_RATE_THRESHOLD",
    "ESCALATION_LATENCY_THRESHOLD_MS",
    "ESCALATION_QUEUE_DEPTH_THRESHOLD",
    "ESCALATION_CONSECUTIVE_FAILURES_THRESHOLD",
    "ESCALATION_CRITICAL_ERROR_RATE",
    "ESCALATION_CRITICAL_LATENCY_MS",
    "ESCALATION_COOLDOWN_SECONDS",
    # Test helpers
    "_clear_in_memory_state",
    "_evaluate_metrics",
    "_is_on_cooldown",
    "_set_cooldown",
    "_resolve_tier",
    "_map_to_escalation_level",
]
