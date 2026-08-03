"""
Per-tier SLA Priority Queues (AIM-2019).

Maps customer plan tiers to dedicated Celery queues with distinct priority
levels so higher-tier tenants enjoy faster task processing.

Tier hierarchy (highest → lowest priority):
    enterprise  → queue: syntaro.sla.enterprise  (priority 9)
    team        → queue: syntaro.sla.team        (priority 6)
    solo        → queue: syntaro.sla.solo        (priority 3)
    free        → queue: syntaro.sla.free        (priority 0)

Celery Queue Priority
---------------------
Celery brokers (RabbitMQ, Redis, SQS) support per-message priority via the
``task_priority`` (or ``priority``) argument on ``apply_async()``.  Values
range 0–255; higher values = higher priority.

This module exposes:

* ``TIER_QUEUES``       — list of ``kombu.Queue`` objects for registration.
* ``TIER_ROUTES``       — dict for ``CELERY_TASK_ROUTES`` (routes based on
                          task name patterns; overridden at call time by the
                          middleware which passes the per-tier queue).
* ``SlaPriorityRouter`` — a Celery :class:`~celery.routes.BaseRouter`
                          subclass that picks the queue based on a tenant's
                          tier.  Attach to ``CELERY_TASK_ROUTER``.
* Helper functions: ``queue_for_tier()``, ``priority_for_tier()``,
  ``resolve_queue()``, ``tier_for_queue()``, ``apply_sla_priority()``.

Usage
-----

**1. Register queues in** ``celeryconfig.py``::

    from workers.orchestrator.sla_priority import TIER_QUEUES
    task_queues = [
        … existing queues …,
        *TIER_QUEUES,
    ]

**2. Route tasks per tier (see** ``SlaPriorityRouter`` **below)**.

**3. At dispatch time, call** ``apply_sla_priority()`` **or pass the queue
   directly**::

    from workers.orchestrator.sla_priority import queue_for_tier

    task.apply_async(
        args=(…),
        queue=queue_for_tier("enterprise"),
        priority=9,
    )
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from kombu import Exchange, Queue

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Canonical tier → priority mapping
# ---------------------------------------------------------------------------
# Priority values are deliberately spaced (3 apart) so there is room to
# insert intermediate tiers or sub-tiers later without renumbering.

_TIER_CONFIG: dict[str, dict[str, Any]] = {
    "enterprise": {
        "priority": int(os.getenv("SLA_PRIORITY_ENTERPRISE", "9")),
        "queue": os.getenv("SLA_QUEUE_ENTERPRISE", "syntaro.sla.enterprise"),
    },
    "team": {
        "priority": int(os.getenv("SLA_PRIORITY_TEAM", "6")),
        "queue": os.getenv("SLA_QUEUE_TEAM", "syntaro.sla.team"),
    },
    "solo": {
        "priority": int(os.getenv("SLA_PRIORITY_SOLO", "3")),
        "queue": os.getenv("SLA_QUEUE_SOLO", "syntaro.sla.solo"),
    },
    "free": {
        "priority": int(os.getenv("SLA_PRIORITY_FREE", "0")),
        "queue": os.getenv("SLA_QUEUE_FREE", "syntaro.sla.free"),
    },
}

_TIER_NAMES: frozenset[str] = frozenset(_TIER_CONFIG)
_DEFAULT_TIER: str = "free"

# Shared exchange used by all SLA queues
_SLA_EXCHANGE = Exchange("syntaro.sla", type="direct", durable=True)

# ---------------------------------------------------------------------------
# Public: queue / priority resolution
# ---------------------------------------------------------------------------


def queue_for_tier(tier: str) -> str:
    """Return the Celery queue name for the given plan *tier*.

    Falls back to the ``free`` queue for unknown tiers.
    """
    config = _TIER_CONFIG.get(tier.lower().strip())
    if config is None:
        logger.warning("Unknown tier %r — falling back to %s queue", tier, _DEFAULT_TIER)
        return _TIER_CONFIG[_DEFAULT_TIER]["queue"]
    return config["queue"]


def priority_for_tier(tier: str) -> int:
    """Return the Celery message priority (0–255) for the given *tier*.

    Returns 0 for unknown tiers.
    """
    config = _TIER_CONFIG.get(tier.lower().strip())
    if config is None:
        return _TIER_CONFIG[_DEFAULT_TIER]["priority"]
    return config["priority"]


def tier_for_queue(queue_name: str) -> Optional[str]:
    """Reverse-lookup: return the tier name for a known SLA queue, or
    ``None`` if *queue_name* is not an SLA-managed queue."""
    for tier, config in _TIER_CONFIG.items():
        if config["queue"] == queue_name:
            return tier
    return None


def resolve_tier(raw: str | None) -> str:
    """Normalise a tier string to one of the known tier names.

    Handles ``None``, casing differences, and unknown values.
    """
    if raw and raw.lower().strip() in _TIER_NAMES:
        return raw.lower().strip()
    return _DEFAULT_TIER


def resolve_queue(tenant_id: str, tier: str | None = None) -> str:
    """Resolve the appropriate SLA queue for a tenant.

    Uses ``resolve_tier()`` followed by ``queue_for_tier()``.
    """
    return queue_for_tier(resolve_tier(tier))


def apply_sla_priority(
    task: Any,
    tier: str,
    args: tuple = (),
    kwargs: Optional[dict] = None,
    **options: Any,
) -> Any:
    """Call ``task.apply_async()`` with the queue and priority pre-filled
    for *tier*.

    Convenience wrapper so callers do not need to import ``queue_for_tier``
    and ``priority_for_tier`` separately.

        apply_sla_priority(my_task, "enterprise", args=(issue_id,))
    """
    resolved_tier = resolve_tier(tier)
    options.setdefault("queue", queue_for_tier(resolved_tier))
    options.setdefault("priority", priority_for_tier(resolved_tier))
    return task.apply_async(args=args, kwargs=kwargs, **options)


# ---------------------------------------------------------------------------
# Public: Celery queue / route definitions
# ---------------------------------------------------------------------------

TIER_QUEUES: list[Queue] = [
    Queue(config["queue"], _SLA_EXCHANGE, routing_key=config["queue"])
    for config in _TIER_CONFIG.values()
]

TIER_ROUTES: dict[str, dict[str, str]] = {
    # Task patterns that should be routed by tier.
    # These act as defaults — the SlaPriorityRouter or call-site override
    # the queue at dispatch time.
    f"workers.tasks.agent.*": {"queue": queue_for_tier("free")},
}


# ---------------------------------------------------------------------------
# Celery Router
# ---------------------------------------------------------------------------


class SlaPriorityRouter:
    """Celery :class:`~celery.routes.BaseRouter` that resolves the target
    queue from a ``tier`` kwarg on the task.

    When a task is dispatched with ``tier="enterprise"`` in its kwargs, this
    router redirects it to the enterprise queue.

    **Important**: the router only fires when the task's kwargs contain a
    ``tier`` key.  Tasks without a tier are left at their default queue.

    Register in ``celeryconfig.py``::

        from workers.orchestrator.sla_priority import SlaPriorityRouter

        task_routes = [
            … existing route dicts …,
            SlaPriorityRouter(),
        ]
    """

    def route_for_task(
        self,
        task_name: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        options: dict[str, Any],
        task: Any = None,
        **__: Any,
    ) -> Optional[dict[str, Any]]:
        """Inspect the task kwargs for a ``tier`` entry and return the
        matching queue and priority.

        Returns ``None`` when no tier is present (no opinion → default).
        """
        tier: Any = kwargs.get("tier") if kwargs else None
        if not tier or not isinstance(tier, str):
            return None

        resolved = resolve_tier(tier)
        return {
            "queue": queue_for_tier(resolved),
            "priority": priority_for_tier(resolved),
        }


# ---------------------------------------------------------------------------
# Backward-compatible aliases (matching existing module conventions)
# ---------------------------------------------------------------------------

SLA_TIER_QUEUE_MAP: dict[str, str] = {t: queue_for_tier(t) for t in _TIER_NAMES}
SLA_TIER_PRIORITY_MAP: dict[str, int] = {t: priority_for_tier(t) for t in _TIER_NAMES}

__all__ = [
    # Tier configuration
    "TIER_QUEUES",
    "TIER_ROUTES",
    "SLA_TIER_QUEUE_MAP",
    "SLA_TIER_PRIORITY_MAP",
    # Helpers
    "queue_for_tier",
    "priority_for_tier",
    "tier_for_queue",
    "resolve_tier",
    "resolve_queue",
    "apply_sla_priority",
    # Router
    "SlaPriorityRouter",
]
