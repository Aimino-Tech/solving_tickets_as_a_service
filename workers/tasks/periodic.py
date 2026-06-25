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

    health_url = os.getenv("STAS_HEALTH_URL", "http://localhost:3000/health/queue")
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

    dlq_admin_url = os.getenv("STAS_DLQ_ADMIN_URL", "http://localhost:3000/api/v1/admin/dlq/replay")
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

        push_to_gateway(push_gateway, job="stas-celery-worker", registry=REGISTRY)
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


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    name="workers.tasks.periodic.e2b_health_check",
)
def e2b_health_check(self) -> dict:
    """
    Periodic task (every 5 min) to verify the configured E2B template exists
    and is usable. Creates a lightweight sandbox instance, validates the
    template ID, and immediately destroys it.

    Records Prometheus metrics:
      - e2b_health_check (gauge): 1 if healthy, 0 if failed
      - e2b_health_checks_total (counter): total checks by status
      - e2b_health_check_failures_total (counter): failures by error type

    Logs warnings if the template is not found, so operators can detect
    misconfiguration before a fix run fails.
    """
    api_key = os.getenv("E2B_API_KEY", "")
    template_id = os.getenv("E2B_TEMPLATE_ID", "stas-default")

    if not api_key:
        logger.info("E2B_API_KEY not configured -- skipping E2B health check")
        return {"status": "skipped", "reason": "E2B_API_KEY not set"}

    logger.info("Running E2B health check -- template=%s", template_id)

    try:
        from e2b import Sandbox

        start = time.time()
        sandbox = Sandbox.create(
            template=template_id,
            timeout=15,
            api_key=api_key,
        )
        sandbox_id = sandbox.sandbox_id
        sandbox.kill()
        duration = time.time() - start

        logger.info(
            "E2B health check passed -- template=%s sandbox_id=%s duration=%.2fs",
            template_id,
            sandbox_id,
            duration,
        )

        record_gauge("e2b_health_check", 1)
        record_counter("e2b_health_checks_total", 1, status="ok")

        return {
            "status": "ok",
            "template_id": template_id,
            "sandbox_id": sandbox_id,
            "duration_s": round(duration, 2),
            "timestamp": time.time(),
        }
    except ImportError:
        logger.warning("e2b package not installed -- skipping E2B health check")
        return {"status": "skipped", "reason": "e2b package not installed"}
    except Exception as exc:
        err_str = str(exc).lower()
        duration = time.time() - start

        # Classify the error for metrics
        if "template" in err_str and "not found" in err_str:
            error_type = "template_not_found"
            logger.error(
                "E2B HEALTH CRITICAL -- template '%s' not found! "
                "Fix: Update E2B_TEMPLATE_ID in your environment or "
                "create the template in the E2B dashboard.",
                template_id,
            )
        elif "api_key" in err_str or "unauthorized" in err_str or "forbidden" in err_str:
            error_type = "auth_error"
            logger.error("E2B health check FAILED -- authentication error: %s", exc)
        elif "timeout" in err_str:
            error_type = "timeout"
            logger.error("E2B health check FAILED -- timeout: %s", exc)
        elif "quota" in err_str or "rate limit" in err_str or "too many" in err_str:
            error_type = "rate_limited"
            logger.warning("E2B health check -- rate limited: %s", exc)
        else:
            error_type = "unknown"
            logger.error("E2B health check FAILED -- %s", exc, exc_info=True)

        record_gauge("e2b_health_check", 0)
        record_counter("e2b_health_checks_total", 1, status="fail")
        record_counter("e2b_health_check_failures_total", 1, error=error_type)

        raise self.retry(exc=exc)
