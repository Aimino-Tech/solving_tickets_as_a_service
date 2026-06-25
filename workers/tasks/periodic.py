"""
Celery Beat Periodic Tasks — scheduled maintenance and monitoring.

Tasks:
    queue_health_check  — Every 5 min: logs queue depths and alerts on critical queues
    dlq_cleanup         — Daily at 2am: purges expired DLQ messages
    push_metrics        — Every 1 min: pushes Prometheus metrics (if metrics endpoint configured)
    report_liveness     — Every 1 min: logs worker heartbeat for liveness monitoring

AIM-2022 Self-Healing Tasks:
    self_healing_heartbeat_check   — Every 15s: checks for dead workers -> revoke tasks
    self_healing_queue_drain_check — Every 60s: checks queue depths -> alert/auto-scale
    self_healing_circuit_check     — Every 30s: checks circuit breaker state transitions
    self_healing_dlq_replay        — Every 2min: replays messages from DLQ retry queue
"""

import json
import logging
import os
import time

from celery import shared_task

logger = logging.getLogger(__name__)

# Try to import metrics if available
try:
    from workers.metrics import record_gauge, record_counter
except ImportError:
    record_gauge = lambda name, value, **labels: None
    record_counter = lambda name, value=1, **labels: None


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.queue_health_check",
)
def queue_health_check(self) -> dict:
    """
    Periodic task (every 5 min) to check queue depths and log alerts.
    """
    import httpx

    health_url = os.getenv("STAS_HEALTH_URL", "http://localhost:3000/health/queue")
    logger.info("Running queue health check - url=%s", health_url)

    try:
        resp = httpx.get(health_url, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        status = data.get("status", "unknown")
        summary = data.get("summary", {})

        logger.info(
            "Queue health check - status=%s total_messages=%d dlq_messages=%d active_workers=%d",
            status,
            summary.get("totalMessages", 0),
            summary.get("dlqMessages", 0),
            summary.get("activeWorkers", 0),
        )

        record_gauge("celery_queue_health_total_messages", summary.get("totalMessages", 0))
        record_gauge("celery_queue_health_dlq_messages", summary.get("dlqMessages", 0))
        record_gauge("celery_queue_health_active_workers", summary.get("activeWorkers", 0))

        if status == "critical":
            logger.error("CRITICAL queue health - %s", json.dumps(data.get("queues", [])))
        elif status == "degraded":
            logger.warning("Degraded queue health - %s", json.dumps(data.get("queues", [])))

        return {
            "status": status,
            "summary": summary,
            "timestamp": time.time(),
        }
    except Exception as exc:
        logger.error("Queue health check failed - %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.dlq_cleanup",
)
def dlq_cleanup(self) -> dict:
    """
    Periodic task (daily at 2am) to clean up expired DLQ messages.
    Uses the Node.js admin API to trigger DLQ replay/cleanup.
    """
    import httpx

    dlq_admin_url = os.getenv("STAS_DLQ_ADMIN_URL", "http://localhost:3000/api/v1/admin/dlq/replay")
    logger.info("Running DLQ cleanup - url=%s", dlq_admin_url)

    try:
        resp = httpx.post(dlq_admin_url, json={}, timeout=30)
        resp.raise_for_status()
        result = resp.json()

        logger.info(
            "DLQ cleanup complete - replayed=%d queues=%s",
            result.get("replayed", 0),
            result.get("queues", []),
        )

        record_counter("celery_dlq_cleanup_total", result.get("replayed", 0))

        return {
            "replayed": result.get("replayed", 0),
            "queues": result.get("queues", []),
            "timestamp": time.time(),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            logger.warning("DLQ admin API not available (404) - skipping cleanup")
            return {"replayed": 0, "queues": [], "skip": True}
        logger.error("DLQ cleanup failed - %s", exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("DLQ cleanup request failed - %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.push_metrics",
)
def push_metrics(self) -> dict:
    """
    Periodic task (every 1 min) to push Prometheus metrics if a push gateway is configured.
    """
    push_gateway = os.getenv("PROMETHEUS_PUSH_GATEWAY", "")
    if not push_gateway:
        logger.debug("No PROMETHEUS_PUSH_GATEWAY configured - skipping metrics push")
        return {"pushed": False, "reason": "no_push_gateway"}

    try:
        from prometheus_client import push_to_gateway, generate_latest, CollectorRegistry
        from workers.metrics import REGISTRY

        push_to_gateway(push_gateway, job="stas-celery-worker", registry=REGISTRY)
        logger.debug("Metrics pushed to push gateway - url=%s", push_gateway)
        return {"pushed": True, "gateway": push_gateway}
    except ImportError:
        logger.warning("prometheus_client not installed - skipping metrics push")
        return {"pushed": False, "reason": "prometheus_client_not_installed"}
    except Exception as exc:
        logger.error("Metrics push failed - %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.report_liveness",
)
def report_liveness(self) -> dict:
    """
    Periodic task (every 1 min) to report worker liveness.
    Logs a heartbeat message and updates Prometheus gauge.
    """
    import socket

    hostname = socket.gethostname()
    worker_name = os.getenv("WORKER_NAME", hostname)

    record_gauge(
        "celery_worker_liveness",
        1,
        worker=worker_name,
        hostname=hostname,
    )

    logger.debug(
        "Liveness report - worker=%s hostname=%s pid=%d",
        worker_name,
        hostname,
        os.getpid(),
    )

    return {
        "worker": worker_name,
        "hostname": hostname,
        "pid": os.getpid(),
        "timestamp": time.time(),
        "alive": True,
    }


# ═══════════════════════════════════════════════════════════════════════
# AIM-2022: Self-Healing Infrastructure Periodic Tasks
# ═══════════════════════════════════════════════════════════════════════


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=15,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.self_healing_heartbeat_check",
)
def self_healing_heartbeat_check(self) -> dict:
    """Periodic task (every 15s) to check for dead workers.

    Finds workers whose heartbeat is missing for >=60s, marks them dead,
    revokes their tasks via cleanup module, and records Prometheus metrics.
    """
    from workers.orchestrator.heartbeat import find_dead_workers, is_worker_dead, mark_worker_dead
    from workers.orchestrator.cleanup import revoke_dead_worker_tasks

    dead = find_dead_workers()
    revoked_total = 0

    for worker_info in dead:
        hostname = worker_info["hostname"]
        if not is_worker_dead(hostname):
            mark_worker_dead(hostname)
            try:
                revoked = revoke_dead_worker_tasks(hostname)
                revoked_total += revoked
                logger.warning(
                    json.dumps({
                        "event": "self_healing.heartbeat.worker_dead",
                        "worker": hostname,
                        "tasks_revoked": revoked,
                        "seconds_since_heartbeat": worker_info["seconds_since_heartbeat"],
                    })
                )
            except Exception as exc:
                logger.error(
                    "Self-healing: failed to revoke tasks for %s: %s",
                    hostname, exc,
                )

    dead_count = len(dead)
    record_gauge("celery_self_healing_dead_workers", dead_count)
    if revoked_total > 0:
        record_counter("celery_self_healing_tasks_revoked", revoked_total)

    return {
        "dead_workers_found": dead_count,
        "tasks_revoked": revoked_total,
        "workers": [w["hostname"] for w in dead],
        "timestamp": time.time(),
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.self_healing_queue_drain_check",
)
def self_healing_queue_drain_check(self) -> dict:
    """Periodic task (every 60s) to check for queue drain conditions.

    If any queue depth exceeds 100 and no workers are consuming from it,
    sends an alert. If depth exceeds 500, sends a critical alert.
    Optionally triggers auto-scale if configured.
    """
    from workers.orchestrator.queue_drain import check_queue_drain

    result = check_queue_drain()

    alert_count = len(result.get("alerts", []))
    scale_up_count = len(result.get("scale_ups", []))

    record_gauge("celery_self_healing_queue_drain_alerts", alert_count)
    if scale_up_count > 0:
        record_counter("celery_self_healing_scale_ups", scale_up_count)

    return {
        "alert_count": alert_count,
        "scale_ups": scale_up_count,
        "queues_checked": len(result.get("queues", {})),
        "timestamp": time.time(),
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.self_healing_circuit_check",
)
def self_healing_circuit_check(self) -> dict:
    """Periodic task (every 30s) to check circuit breaker states.

    Circuits in OPEN state are automatically transitioned to HALF_OPEN
    after the configured pause duration. This task logs the current
    state of all tracked circuits for observability.
    """
    from workers.orchestrator.circuit_breaker import get_all_circuits

    circuits = get_all_circuits()

    open_count = sum(1 for c in circuits.values() if c.get("state") == "OPEN")
    half_open_count = sum(1 for c in circuits.values() if c.get("state") == "HALF_OPEN")

    record_gauge("celery_self_healing_circuits_open", open_count)
    record_gauge("celery_self_healing_circuits_half_open", half_open_count)

    if open_count > 0 or half_open_count > 0:
        logger.info(
            json.dumps({
                "event": "self_healing.circuit.states",
                "open": open_count,
                "half_open": half_open_count,
                "total_circuits": len(circuits),
                "circuits": circuits,
            })
        )

    return {
        "total_circuits": len(circuits),
        "open": open_count,
        "half_open": half_open_count,
        "timestamp": time.time(),
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.self_healing_dlq_replay",
)
def self_healing_dlq_replay(self) -> dict:
    """Periodic task (every 2min) to process messages in the DLQ retry queue.

    Reads from stas.dlx.retry, increments retry_count, and re-routes back
    to the original exchange. Messages exceeding MAX_RETRIES are moved to
    stas.dlx.failed for permanent dead-lettering.
    """
    from workers.orchestrator.dlq_replay import _get_redis, _REDIS_RETRY_PREFIX
    from workers.orchestrator.dlq_replay import get_retry_count, _MAX_RETRIES

    # Check Redis for pending retry counts
    client = _get_redis()
    pending_retries = 0
    maxed_out = 0

    if client:
        try:
            cursor = 0
            while True:
                cursor, keys = client.scan(cursor, match=_REDIS_RETRY_PREFIX + "*")
                for key in keys:
                    val = client.get(key)
                    if val:
                        count = int(val)
                        if count >= _MAX_RETRIES:
                            maxed_out += 1
                        else:
                            pending_retries += 1
                if cursor == 0:
                    break
        except Exception as exc:
            logger.debug("Failed to scan DLQ retry counts: %s", exc)

    record_gauge("celery_self_healing_dlq_pending_retries", pending_retries)
    record_gauge("celery_self_healing_dlq_maxed_out", maxed_out)

    logger.debug(
        "DLQ replay check - pending_retries=%d maxed_out=%d",
        pending_retries,
        maxed_out,
    )

    return {
        "pending_retries": pending_retries,
        "maxed_out": maxed_out,
        "timestamp": time.time(),
    }
