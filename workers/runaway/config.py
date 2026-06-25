"""
Runaway agent protection — OSS tools configuration.

This module provides configuration defaults for the three OSS tools that
underpin runaway protection:

+------------------+--------------------------------------------------+
| Tool             | Role                                             |
+------------------+--------------------------------------------------+
| BullMQ           | Job queue — ``maxAttempts``, job timeout         |
| supervisor       | Process manager — start/stop/restart limits      |
| OpenTelemetry    | Observability — span emission, sampling, export   |
+------------------+--------------------------------------------------+

Every setting can be overridden via environment variable.  Use
``get_runaway_config()`` to retrieve the full dict at runtime.

Usage::

    from workers.runaway.config import get_runaway_config

    cfg = get_runaway_config()
    max_attempts = cfg["bullmq"]["default_max_attempts"]
    redis_ttl = cfg["redis"]["default_task_ttl_seconds"]
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# BullMQ — job queue configuration
# ---------------------------------------------------------------------------

# Maximum number of times a stalled / failing job is re-attempted before
# it is moved to the dead-letter queue.
BULLMQ_DEFAULT_MAX_ATTEMPTS: int = int(
    os.getenv("STAS_BULLMQ_MAX_ATTEMPTS", "5")
)

# Per-job timeout in seconds (the wall-clock time a job is allowed to run
# before BullMQ marks it as stalled and retries it).
BULLMQ_JOB_TIMEOUT_SECONDS: int = int(
    os.getenv("STAS_BULLMQ_JOB_TIMEOUT_SECONDS", "600")
)

# Time in seconds before a stalled job is considered failed and eligible
# for retry.  BullMQ's default is 30 s; we use a slightly longer window
# to avoid prematurely retrying slow agent tasks.
BULLMQ_STALLED_INTERVAL_SECONDS: int = int(
    os.getenv("STAS_BULLMQ_STALLED_INTERVAL_SECONDS", "45")
)

# Maximum number of concurrent jobs per queue worker.  Corresponds to
# BullMQ's ``concurrency`` option.
BULLMQ_WORKER_CONCURRENCY: int = int(
    os.getenv("STAS_BULLMQ_WORKER_CONCURRENCY", "4")
)

# Maximum time (seconds) a worker waits for a new job before shutting
# down its poll loop.
BULLMQ_DRAIN_DELAY_SECONDS: int = int(
    os.getenv("STAS_BULLMQ_DRAIN_DELAY_SECONDS", "5")
)

# ---------------------------------------------------------------------------
# Supervisor — process management limits
# ---------------------------------------------------------------------------

# Maximum number of consecutive failures before supervisor stops trying
# to restart the process.
SUPERVISOR_MAX_RESTARTS: int = int(
    os.getenv("STAS_SUPERVISOR_MAX_RESTARTS", "3")
)

# Time window (seconds) in which the max-restarts limit is evaluated.
# If the process crashes MAX_RESTARTS times within this window,
# supervisor enters FATAL state.
SUPERVISOR_RESTART_WINDOW_SECONDS: int = int(
    os.getenv("STAS_SUPERVISOR_RESTART_WINDOW_SECONDS", "60")
)

# Delay (seconds) between automatic restart attempts.
SUPERVISOR_RESTART_DELAY_SECONDS: int = int(
    os.getenv("STAS_SUPERVISOR_RESTART_DELAY_SECONDS", "5")
)

# Process priority — lower numbers are started first and shut down last.
# Agent dispatch workers should be prioritised above housekeeping.
SUPERVISOR_PRIORITY_AGENT: int = int(
    os.getenv("STAS_SUPERVISOR_PRIORITY_AGENT", "100")
)
SUPERVISOR_PRIORITY_HOUSEKEEPING: int = int(
    os.getenv("STAS_SUPERVISOR_PRIORITY_HOUSEKEEPING", "200")
)

# Whether supervisor should autostart the process group on supervisor
# startup.  Set to "false" in maintenance windows.
SUPERVISOR_AUTOSTART: bool = (
    os.getenv("STAS_SUPERVISOR_AUTOSTART", "true").lower() == "true"
)

# ---------------------------------------------------------------------------
# OpenTelemetry — observability configuration
# ---------------------------------------------------------------------------

# OTLP endpoint URL.  Empty string means "no exporter configured" — spans
# are still created but are dropped at the exporter level.
OTEL_EXPORTER_OTLP_ENDPOINT: str = os.getenv(
    "OTEL_EXPORTER_OTLP_ENDPOINT", ""
)

# Service name for the tracing dashboard.
OTEL_SERVICE_NAME: str = os.getenv(
    "OTEL_SERVICE_NAME", "stas-runaway"
)

# Sampling rate (0.0 – 1.0).  1.0 = sample every span; 0.1 = sample 10%.
OTEL_TRACES_SAMPLER_ARG: float = float(
    os.getenv("OTEL_TRACES_SAMPLER_ARG", "1.0")
)

# Span attribute that marks the runaway guard's execution phase.
OTEL_SPAN_NAME_RUNAWAY: str = os.getenv(
    "STAS_OTEL_SPAN_RUNAWAY", "stas.runaway.execution"
)

# Batch span processor configuration.
OTEL_BATCH_MAX_QUEUE_SIZE: int = int(
    os.getenv("OTEL_BSP_MAX_QUEUE_SIZE", "2048")
)
OTEL_BATCH_MAX_EXPORT_BATCH_SIZE: int = int(
    os.getenv("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", "512")
)
OTEL_BATCH_SCHEDULE_DELAY_MS: int = int(
    os.getenv("OTEL_BSP_SCHEDULE_DELAY", "5000")
)

# ---------------------------------------------------------------------------
# Redis key TTL defaults
# ---------------------------------------------------------------------------

# Default TTL for per-task tracking keys (start time, tokens, cost).
# 7200 s = 2 hours — should cover any long-running agent task.
REDIS_TASK_TTL_SECONDS: int = int(
    os.getenv("STAS_REDIS_TASK_TTL_SECONDS", "7200")
)

# TTL for the "already labeled" deduplication key.
REDIS_LABEL_TTL_SECONDS: int = int(
    os.getenv("STAS_REDIS_LABEL_TTL_SECONDS", "86400")
)

# TTL for retry counters.
REDIS_RETRY_TTL_SECONDS: int = int(
    os.getenv("STAS_REDIS_RETRY_TTL_SECONDS", "86400")
)

# TTL for turn-limit locks (limits.py).
REDIS_TURN_LOCK_TTL_SECONDS: int = int(
    os.getenv("STAS_REDIS_TURN_LOCK_TTL_SECONDS", "3600")
)

# TTL for cost-cap locks (limits.py).
REDIS_COST_CAP_TTL_SECONDS: int = int(
    os.getenv("STAS_REDIS_COST_CAP_TTL_SECONDS", "86400")
)

# ---------------------------------------------------------------------------
# Full config accessor
# ---------------------------------------------------------------------------


def get_runaway_config() -> dict[str, Any]:
    """Return the full runaway-protection configuration dict.

    Every key is derived from the module-level constants, which can be
    set via environment variables at import time.
    """
    return {
        "bullmq": {
            "default_max_attempts": BULLMQ_DEFAULT_MAX_ATTEMPTS,
            "job_timeout_seconds": BULLMQ_JOB_TIMEOUT_SECONDS,
            "stalled_interval_seconds": BULLMQ_STALLED_INTERVAL_SECONDS,
            "worker_concurrency": BULLMQ_WORKER_CONCURRENCY,
            "drain_delay_seconds": BULLMQ_DRAIN_DELAY_SECONDS,
        },
        "supervisor": {
            "max_restarts": SUPERVISOR_MAX_RESTARTS,
            "restart_window_seconds": SUPERVISOR_RESTART_WINDOW_SECONDS,
            "restart_delay_seconds": SUPERVISOR_RESTART_DELAY_SECONDS,
            "priority_agent": SUPERVISOR_PRIORITY_AGENT,
            "priority_housekeeping": SUPERVISOR_PRIORITY_HOUSEKEEPING,
            "autostart": SUPERVISOR_AUTOSTART,
        },
        "opentelemetry": {
            "exporter_otlp_endpoint": OTEL_EXPORTER_OTLP_ENDPOINT,
            "service_name": OTEL_SERVICE_NAME,
            "traces_sampler_arg": OTEL_TRACES_SAMPLER_ARG,
            "span_name_runaway": OTEL_SPAN_NAME_RUNAWAY,
            "batch_max_queue_size": OTEL_BATCH_MAX_QUEUE_SIZE,
            "batch_max_export_batch_size": OTEL_BATCH_MAX_EXPORT_BATCH_SIZE,
            "batch_schedule_delay_ms": OTEL_BATCH_SCHEDULE_DELAY_MS,
        },
        "redis": {
            "task_ttl_seconds": REDIS_TASK_TTL_SECONDS,
            "label_ttl_seconds": REDIS_LABEL_TTL_SECONDS,
            "retry_ttl_seconds": REDIS_RETRY_TTL_SECONDS,
            "turn_lock_ttl_seconds": REDIS_TURN_LOCK_TTL_SECONDS,
            "cost_cap_ttl_seconds": REDIS_COST_CAP_TTL_SECONDS,
        },
    }
