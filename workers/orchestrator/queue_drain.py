"""
Queue Drain Monitor — checks queue depth and alerts / acts when queues back up.

If any queue depth exceeds 100 messages **and** there are no active workers
consuming from that queue, the monitor either auto-scales (if configured) or
warns via the alerting system.

Design
------
    1. Queue depth is checked via the RabbitMQ Management HTTP API or Redis.
    2. Active workers are checked via Celery ``inspect()`` or RabbitMQ API.
    3. If depth > threshold AND no workers -> warn or auto-scale.
    4. If depth > critical threshold -> critical alert regardless of workers.

Configuration (env vars)
------------------------
    ``QUEUE_DRAIN_WARN_DEPTH`` (default: 100) — depth threshold for warnings.
    ``QUEUE_DRAIN_CRIT_DEPTH`` (default: 500) — depth threshold for critical alerts.
    ``QUEUE_DRAIN_CHECK_INTERVAL_S`` (default: 60) — how often to check.
    ``QUEUE_DRAIN_AUTO_SCALE`` (default: ``false``) — enable auto-scaling.
    ``QUEUE_DRAIN_SCALE_UP_URL`` — URL to call for scaling up workers.
    ``QUEUE_DRAIN_SCALE_UP_BY`` (default: 1) — number of worker instances to add.
    ``RABBITMQ_MANAGEMENT_URL`` (default: ``http://guest:guest@localhost:15672/api/``)
        — RabbitMQ management API base URL.

Redis / Celery
--------------
    Uses the same Redis connection pattern as other orchestrator modules.
    Also uses Celery ``inspect()`` to detect active workers per queue.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

from celery import current_app

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_WARN_DEPTH = int(os.getenv("QUEUE_DRAIN_WARN_DEPTH", "100"))
_CRIT_DEPTH = int(os.getenv("QUEUE_DRAIN_CRIT_DEPTH", "500"))
_CHECK_INTERVAL_S = int(os.getenv("QUEUE_DRAIN_CHECK_INTERVAL_S", "60"))
_AUTO_SCALE = os.getenv("QUEUE_DRAIN_AUTO_SCALE", "false").lower() == "true"
_SCALE_UP_URL = os.getenv("QUEUE_DRAIN_SCALE_UP_URL", "")
_SCALE_UP_BY = int(os.getenv("QUEUE_DRAIN_SCALE_UP_BY", "1"))
_RABBITMQ_MGMT_URL = os.getenv(
    "RABBITMQ_MANAGEMENT_URL",
    "http://guest:guest@localhost:15672/api/",
)

# ---------------------------------------------------------------------------
# Known queues to monitor (matches celeryconfig.py)
# ---------------------------------------------------------------------------

_QUEUES_TO_MONITOR = [
    "stas.agents.dispatch",
    "stas.agents.verification",
    "stas.agents.sandbox",
    "stas.agents.self_audit",
    "stas.issues.triage",
    "stas.issues.health",
    "stas.queue.pr",
    "stas.queue.notifications",
    "stas.queue.orchestrator",
    "stas.dlx.retry",
    "stas.dlx.failed",
    "stas.quality.enforce",
]

# ---------------------------------------------------------------------------
# Queue depth checks
# ---------------------------------------------------------------------------


def _get_rabbitmq_depth(queue_name: str) -> Optional[int]:
    """Get queue depth via RabbitMQ Management HTTP API.

    Returns the number of messages (ready + unacknowledged) or ``None`` if
    the management API is unreachable.
    """
    import httpx

    api_url = _RABBITMQ_MGMT_URL.rstrip("/") + "/queues/%2F/" + queue_name
    try:
        response = httpx.get(api_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        return (data.get("messages_ready", 0) or 0) + (data.get("messages_unacknowledged", 0) or 0)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return 0  # Queue doesn't exist yet
        logger.debug("RabbitMQ API error for %s: %s", queue_name, exc)
        return None
    except Exception as exc:
        logger.debug("Failed to get queue depth via RabbitMQ API for %s: %s", queue_name, exc)
        return None


def _get_redis_depth(queue_name: str) -> Optional[int]:
    """Get queue depth via Redis (for Celery/BullMQ queues).

    Celery uses Redis lists with the ``celery`` prefix for unacknowledged
    messages. This is a rough approximation.
    """
    from workers.orchestrator.heartbeat import _get_redis as _get_hb_redis

    client = _get_hb_redis()
    if not client:
        return None

    try:
        # Celery stores unacknowledged tasks in a list keyed by queue name prefixed
        key = "celery:" + queue_name
        depth = client.llen(key)
        return depth if depth is not None else 0
    except Exception:
        return None


def get_queue_depth(queue_name: str) -> int:
    """Get the depth of a queue.

    Tries RabbitMQ Management API first, falls back to Redis, returns 0 if
    neither is available.
    """
    # Try RabbitMQ API first
    depth = _get_rabbitmq_depth(queue_name)
    if depth is not None:
        return depth

    # Fallback to Redis
    depth = _get_redis_depth(queue_name)
    if depth is not None:
        return depth

    return 0


# ---------------------------------------------------------------------------
# Worker checks
# ---------------------------------------------------------------------------


def get_active_workers_for_queue(queue_name: str) -> list[str]:
    """Get hostnames of workers that are consuming from the given queue.

    Uses Celery ``inspect()`` to list active tasks and matches them by queue.
    """
    try:
        i = current_app.control.inspect()
        active = i.active() or {}
        reserved = i.reserved() or {}

        workers_for_queue: set[str] = set()

        for worker_hostname, tasks in active.items():
            for task in tasks:
                if task.get("delivery_info", {}).get("routing_key", "") == queue_name:
                    workers_for_queue.add(worker_hostname)
                if task.get("delivery_info", {}).get("queue", "") == queue_name:
                    workers_for_queue.add(worker_hostname)

        for worker_hostname, tasks in reserved.items():
            for task in tasks:
                if task.get("delivery_info", {}).get("routing_key", "") == queue_name:
                    workers_for_queue.add(worker_hostname)
                if task.get("delivery_info", {}).get("queue", "") == queue_name:
                    workers_for_queue.add(worker_hostname)

        return list(workers_for_queue)
    except Exception as exc:
        logger.debug("Failed to inspect workers for queue %s: %s", queue_name, exc)
        return []


# ---------------------------------------------------------------------------
# Scaling
# ---------------------------------------------------------------------------


def _trigger_scale_up(queue_name: str, depth: int) -> bool:
    """Trigger an auto-scale event (calls the configured scale-up URL).

    Returns:
        ``True`` if the scale-up was triggered successfully.
    """
    if not _AUTO_SCALE or not _SCALE_UP_URL:
        logger.info(
            json.dumps({
                "event": "queue_drain.scale_up_skipped",
                "queue": queue_name,
                "depth": depth,
                "reason": "auto-scale not configured",
            })
        )
        return False

    try:
        import httpx

        payload = {
            "queue": queue_name,
            "depth": depth,
            "scale_by": _SCALE_UP_BY,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        response = httpx.post(_SCALE_UP_URL, json=payload, timeout=30)
        response.raise_for_status()
        logger.warning(
            json.dumps({
                "event": "queue_drain.scale_up_triggered",
                "queue": queue_name,
                "depth": depth,
                "scale_by": _SCALE_UP_BY,
            })
        )
        return True
    except Exception as exc:
        logger.error("Failed to trigger scale-up for %s: %s", queue_name, exc)
        return False


# ---------------------------------------------------------------------------
# Main check
# ---------------------------------------------------------------------------


def _send_alert(message: str, severity: str = "warning", context: Optional[dict] = None) -> None:
    """Send an alert to the monitoring system."""
    logger.log(
        logging.WARNING if severity == "warning" else logging.ERROR,
        json.dumps({
            "event": "queue_drain.alert",
            "severity": severity,
            "message": message,
            "context": context or {},
        })
    )

    # Update Prometheus metric
    try:
        from workers.metrics import record_gauge
        record_gauge("celery_queue_drain_alerts", 1, severity=severity, queue=context.get("queue", "unknown") if context else "unknown")
    except ImportError:
        pass


def check_queue_drain() -> dict[str, Any]:
    """Check all monitored queues for drain conditions.

    For each queue:
      1. Get depth
      2. Get active workers for that queue
      3. If depth > WARN_DEPTH and no workers -> warn / auto-scale
      4. If depth > CRIT_DEPTH -> critical alert

    Returns:
        A dict with summary info.
    """
    results: dict[str, Any] = {
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "queues": {},
        "alerts": [],
        "scale_ups": [],
    }

    for queue_name in _QUEUES_TO_MONITOR:
        depth = get_queue_depth(queue_name)
        workers = get_active_workers_for_queue(queue_name)
        has_workers = len(workers) > 0

        queue_info: dict[str, Any] = {
            "depth": depth,
            "active_workers": workers,
            "has_workers": has_workers,
        }

        # Check drain condition: depth > warn AND no workers
        if depth > _WARN_DEPTH and not has_workers:
            msg = (
                "Queue '%s' depth=%d exceeds warn threshold=%d with no active workers"
                % (queue_name, depth, _WARN_DEPTH)
            )
            _send_alert(msg, severity="warning", context={"queue": queue_name, "depth": depth})
            results["alerts"].append({"queue": queue_name, "severity": "warning", "message": msg})
            queue_info["drain_status"] = "warning"

            # Auto-scale if configured
            if _AUTO_SCALE:
                scaled = _trigger_scale_up(queue_name, depth)
                if scaled:
                    results["scale_ups"].append({"queue": queue_name, "depth": depth})

        # Critical depth check (regardless of workers)
        if depth > _CRIT_DEPTH:
            msg = (
                "Queue '%s' depth=%d exceeds critical threshold=%d"
                % (queue_name, depth, _CRIT_DEPTH)
            )
            _send_alert(msg, severity="critical", context={"queue": queue_name, "depth": depth})
            results["alerts"].append({"queue": queue_name, "severity": "critical", "message": msg})
            queue_info["drain_status"] = "critical"

        if "drain_status" not in queue_info:
            queue_info["drain_status"] = "ok"

        results["queues"][queue_name] = queue_info

    # Log summary
    alert_count = len(results["alerts"])
    if alert_count > 0:
        logger.warning(
            json.dumps({
                "event": "queue_drain.check_complete",
                "alert_count": alert_count,
                "scale_ups": len(results["scale_ups"]),
            })
        )
    else:
        logger.debug("Queue drain check completed - all queues healthy")

    # Update Prometheus gauge
    try:
        from workers.metrics import record_gauge
        record_gauge("celery_queue_drain_check_total", 1)
    except ImportError:
        pass

    return results


# ---------------------------------------------------------------------------
# Periodic task wrapper
# ---------------------------------------------------------------------------


@current_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.orchestrator.queue_drain.check_queue_drain_task",
    autoretry_for=(Exception,),
)
def check_queue_drain_task(self) -> dict[str, Any]:
    """Celery task wrapper for check_queue_drain()."""
    return check_queue_drain()
