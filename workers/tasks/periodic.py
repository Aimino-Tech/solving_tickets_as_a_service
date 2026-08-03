"""
Celery Beat Periodic Tasks — scheduled maintenance and monitoring.

Tasks:
    queue_health_check  — Every 5 min: logs queue depths and alerts on critical queues
    dlq_cleanup         — Daily at 2am: purges expired DLQ messages
    push_metrics        — Every 1 min: pushes Prometheus metrics (if metrics endpoint configured)
    report_liveness     — Every 1 min: logs worker heartbeat for liveness monitoring
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

    health_url = os.getenv("SYNTARO_HEALTH_URL", "http://localhost:3000/health/queue")
    logger.info("Running queue health check — url=%s", health_url)

    try:
        resp = httpx.get(health_url, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        status = data.get("status", "unknown")
        summary = data.get("summary", {})

        logger.info(
            "Queue health check — status=%s total_messages=%d dlq_messages=%d active_workers=%d",
            status,
            summary.get("totalMessages", 0),
            summary.get("dlqMessages", 0),
            summary.get("activeWorkers", 0),
        )

        record_gauge("celery_queue_health_total_messages", summary.get("totalMessages", 0))
        record_gauge("celery_queue_health_dlq_messages", summary.get("dlqMessages", 0))
        record_gauge("celery_queue_health_active_workers", summary.get("activeWorkers", 0))

        if status == "critical":
            logger.error("CRITICAL queue health — %s", json.dumps(data.get("queues", [])))
        elif status == "degraded":
            logger.warning("Degraded queue health — %s", json.dumps(data.get("queues", [])))

        return {
            "status": status,
            "summary": summary,
            "timestamp": time.time(),
        }
    except Exception as exc:
        logger.error("Queue health check failed — %s", exc)
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

    dlq_admin_url = os.getenv("SYNTARO_DLQ_ADMIN_URL", "http://localhost:3000/api/v1/admin/dlq/replay")
    logger.info("Running DLQ cleanup — url=%s", dlq_admin_url)

    try:
        resp = httpx.post(dlq_admin_url, json={}, timeout=30)
        resp.raise_for_status()
        result = resp.json()

        logger.info(
            "DLQ cleanup complete — replayed=%d queues=%s",
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
            logger.warning("DLQ admin API not available (404) — skipping cleanup")
            return {"replayed": 0, "queues": [], "skip": True}
        logger.error("DLQ cleanup failed — %s", exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("DLQ cleanup request failed — %s", exc)
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
        logger.debug("No PROMETHEUS_PUSH_GATEWAY configured — skipping metrics push")
        return {"pushed": False, "reason": "no_push_gateway"}

    try:
        from prometheus_client import push_to_gateway, generate_latest, CollectorRegistry
        from workers.metrics import REGISTRY

        push_to_gateway(push_gateway, job="syntaro-celery-worker", registry=REGISTRY)
        logger.debug("Metrics pushed to push gateway — url=%s", push_gateway)
        return {"pushed": True, "gateway": push_gateway}
    except ImportError:
        logger.warning("prometheus_client not installed — skipping metrics push")
        return {"pushed": False, "reason": "prometheus_client_not_installed"}
    except Exception as exc:
        logger.error("Metrics push failed — %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.sla_compliance_check",
)
def sla_compliance_check(self) -> dict:
    try:
        from workers.billing.sla import get_sla_tracker
        tracker = get_sla_tracker()
        tenant_ids = tracker.get_all_tenant_ids()
        total_breaches = 0
        active_escalations = 0
        total_tickets = 0
        for tid in tenant_ids:
            status = tracker.get_tenant_status(tid)
            total_tickets += status.total_tickets
            total_breaches += status.response_breaches + status.resolution_breaches
            active_escalations += status.current_escalations
            record_gauge("syntaro_sla_tenant_breaches", float(status.response_breaches + status.resolution_breaches), tenant_id=tid, tier=status.tier)
            record_gauge("syntaro_sla_tenant_active_tickets", float(status.active_tickets), tenant_id=tid, tier=status.tier)
        record_gauge("syntaro_sla_total_tenants", float(len(tenant_ids)))
        record_gauge("syntaro_sla_total_breaches", float(total_breaches))
        record_gauge("syntaro_sla_active_escalations", float(active_escalations))
        record_gauge("syntaro_sla_total_tickets", float(total_tickets))
        return {"tenants": len(tenant_ids), "total_tickets": total_tickets, "total_breaches": total_breaches, "active_escalations": active_escalations, "timestamp": time.time()}
    except Exception as exc:
        logger.error("SLA compliance check failed -- %s", exc)
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
        "Liveness report — worker=%s hostname=%s pid=%d",
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
