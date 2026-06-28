"""
Celery native autoscaling fallback.

When KEDA is not available in the deployment environment, this module
configures Celery's built-in ``--autoscale`` option to dynamically
adjust the number of worker processes based on queue load.

The autoscale range (min, max) is resolved from:

1. ``CELERY_AUTOSCALE_MIN`` / ``CELERY_AUTOSCALE_MAX`` env vars
2. Defaults from ``keda_config.DEFAULT_MIN_CONCURRENCY`` /
   ``DEFAULT_MAX_CONCURRENCY``

Usage:
    from workers.scaling import configure_scaling
    configure_scaling(app)
"""

from __future__ import annotations

import logging
import os

from workers.scaling.keda_config import DEFAULT_MAX_CONCURRENCY, DEFAULT_MIN_CONCURRENCY

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Env var overrides
# ---------------------------------------------------------------------------

ENV_MIN_CONCURRENCY = "CELERY_AUTOSCALE_MIN"
ENV_MAX_CONCURRENCY = "CELERY_AUTOSCALE_MAX"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_concurrency() -> tuple[int, int]:
    """Resolve ``(min, max)`` concurrency from env or defaults.

    Priority:
    1. ``CELERY_AUTOSCALE_MIN`` / ``CELERY_AUTOSCALE_MAX`` env vars
    2. Module defaults (``DEFAULT_MIN_CONCURRENCY``, ``DEFAULT_MAX_CONCURRENCY``)

    Ensures ``min <= max``.
    """
    min_c = int(os.getenv(ENV_MIN_CONCURRENCY, str(DEFAULT_MIN_CONCURRENCY)))
    max_c = int(os.getenv(ENV_MAX_CONCURRENCY, str(DEFAULT_MAX_CONCURRENCY)))
    return max(0, min_c), max(min_c, max_c)


def build_autoscale_arg() -> str | None:
    """Build the ``--autoscale`` argument string for Celery workers.

    Returns ``"MIN,MAX"`` for Celery's ``--autoscale`` flag, or
    ``None`` if ``min >= max`` (fixed concurrency — no autoscaling
    needed).
    """
    min_c, max_c = resolve_concurrency()
    if min_c >= max_c:
        logger.info(
            "Autoscale disabled — min=%d equals max=%d, using fixed concurrency",
            min_c,
            max_c,
        )
        return None
    logger.info(
        "Autoscale configured — min=%d, max=%d",
        min_c,
        max_c,
    )
    return f"{min_c},{max_c}"


def apply_autoscale(app: object) -> None:
    """Apply Celery native autoscale to *app*.

    Sets ``worker_autoscale`` on the Celery application so the worker
    pool dynamically adjusts concurrency.
    """
    arg = build_autoscale_arg()
    if arg is not None:
        from celery import Celery

        if isinstance(app, Celery):
            app.conf.worker_autoscale = arg
            logger.info("Celery native autoscale applied: %s", arg)
        else:
            logger.warning(
                "Expected Celery app, got %s — autoscale not applied",
                type(app).__name__,
            )
    else:
        logger.info("Celery native autoscale skipped (fixed concurrency)")
