"""
Worker scaling — KEDA ScaledObject integration and Celery native fallback.

Provides a unified API to configure worker auto-scaling based on the
deployment environment:

1. **KEDA mode** (default in Kubernetes) — the ``k8s/keda-scaled-object.yaml``
   manifest controls pod-level scaling via RabbitMQ queue depth.  The
   Python side starts a queue-depth metrics exporter on ``:9091/keda-metrics``
   for KEDA's Prometheus scaler.

2. **Celery native fallback** (no KEDA) — applies Celery's built-in
   ``--autoscale`` option to dynamically adjust per-process concurrency
   based on queue load.

Usage:
    from workers.scaling import configure_scaling

    # During Celery app init:
    configure_scaling(app)
"""

from __future__ import annotations

import logging

from workers.scaling.celery_autoscale import apply_autoscale
from workers.scaling.keda import (
    KedaMetricsCollector,
    get_collector,
    is_keda_available,
    start_keda_metrics_server,
)
from workers.scaling.keda_config import (
    get_concurrency_range,
    get_queue_threshold,
)

logger = logging.getLogger(__name__)


def configure_scaling(app: object) -> None:
    """Configure worker scaling based on the deployment environment.

    * If KEDA is detected, start the queue-depth metrics exporter and
      log that KEDA is active (the ``ScaledObject`` handles pod-level
      scaling; no Python-side concurrency tweaking needed).
    * Otherwise, apply Celery native autoscale (min/max concurrency)
      so the worker pool still adapts to queue load.
    """
    if is_keda_available():
        logger.info(
            "KEDA ScaledObject detected — pod-level autoscaling active. "
            "Starting KEDA metrics exporter."
        )
        try:
            start_keda_metrics_server()
            logger.info("KEDA metrics exporter started on :9091/keda-metrics")
        except Exception as exc:
            logger.warning("Failed to start KEDA metrics exporter — %s", exc)
    else:
        logger.info(
            "KEDA not detected — applying Celery native autoscale fallback"
        )
        apply_autoscale(app)


__all__ = [
    "configure_scaling",
    "is_keda_available",
    "get_queue_threshold",
    "get_concurrency_range",
    "KedaMetricsCollector",
    "get_collector",
    "start_keda_metrics_server",
]
