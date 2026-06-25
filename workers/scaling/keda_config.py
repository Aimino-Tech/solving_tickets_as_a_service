"""
KEDA ScaledObject configuration for Celery worker auto-scaling.

This module provides the configuration constants and helper functions
that define how the Celery worker pool should scale:

* In Kubernetes with KEDA installed, the ``k8s/scaled-object.yaml``
  manifest reads queue-depth thresholds from the values defined here.

* Without KEDA, the Celery native autoscaler (``celery_autoscale.py``)
  uses the per-queue concurrency ranges from this module.

Design
------
* ``QUEUE_SCALING_THRESHOLDS`` — backlog depth that triggers a scale-up
  per queue.  Shorter queues (notifications, triage) tolerate deeper
  backlogs; critical queues (dispatch) scale up at just 2.

* ``QUEUE_CONCURRENCY`` — (min, max) worker concurrency per queue for
  Celery's native ``--autoscale``.

* ``is_keda_available()`` — checks the ``KEDA_ENABLED`` env var to
  determine whether KEDA is managing pod-level scaling.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Queue Scaling Thresholds
# ---------------------------------------------------------------------------
# Each queue has a target backlog length (ready + unacknowledged messages)
# that triggers a scale-up event in KEDA.  Lower values = more aggressive
# scaling for that queue.

QUEUE_SCALING_THRESHOLDS: dict[str, int] = {
    "stas.agents.triage": 5,
    "stas.agents.dispatch": 2,
    "stas.agents.sandbox": 3,
    "stas.agents.verification": 3,
    "stas.agents.pr_creation": 5,
    "stas.agents.notifications": 10,
    "stas.agents.default": 5,
}

# ---------------------------------------------------------------------------
# Concurrency Settings (Celery native fallback)
# ---------------------------------------------------------------------------
# (min_concurrency, max_concurrency) per queue.  Used by
# ``celery_autoscale.py`` when KEDA is not deployed.  A min of 0
# means the queue can scale to zero workers.

QUEUE_CONCURRENCY: dict[str, tuple[int, int]] = {
    "stas.agents.triage": (1, 4),
    "stas.agents.dispatch": (0, 4),
    "stas.agents.sandbox": (1, 6),
    "stas.agents.verification": (1, 4),
    "stas.agents.pr_creation": (0, 3),
    "stas.agents.notifications": (1, 3),
    "stas.agents.default": (1, 2),
}

DEFAULT_MIN_CONCURRENCY: int = 1
DEFAULT_MAX_CONCURRENCY: int = 8

# ---------------------------------------------------------------------------
# KEDA Detection
# ---------------------------------------------------------------------------

KEDA_ENABLED_ENV = "KEDA_ENABLED"


def is_keda_available() -> bool:
    """Detect whether KEDA is available in the deployment environment.

    Reads the ``KEDA_ENABLED`` environment variable.  In Kubernetes
    where the ScaledObject is applied, the operator sets this to
    ``"true"`` so the Python worker skips Celery native autoscale.
    """
    return os.getenv(KEDA_ENABLED_ENV, "false").lower() in ("true", "1", "yes")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_queue_threshold(queue_name: str) -> int:
    """Return the scaling threshold for *queue_name*.

    Falls back to 5 for unknown queues.
    """
    return QUEUE_SCALING_THRESHOLDS.get(queue_name, 5)


def get_concurrency_range(queue_name: str) -> tuple[int, int]:
    """Return ``(min_concurrency, max_concurrency)`` for *queue_name*.

    Falls back to ``(DEFAULT_MIN_CONCURRENCY, DEFAULT_MAX_CONCURRENCY)``.
    """
    return QUEUE_CONCURRENCY.get(queue_name, (DEFAULT_MIN_CONCURRENCY, DEFAULT_MAX_CONCURRENCY))
