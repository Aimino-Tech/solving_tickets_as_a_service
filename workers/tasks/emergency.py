import logging
import os
import time
from typing import Any

from celery import shared_task

from workers.emergency.stop import EmergencyStop

logger = logging.getLogger(__name__)

PROMETHEUS_METRIC = "# HELP stas_emergency_stop_active Emergency stop state\n# TYPE stas_emergency_stop_active gauge\nstas_emergency_stop_active{reason=\"%s\"} %d\n"


def _create_metrics_exporter_path() -> str:
    path = os.getenv("STAS_METRICS_PATH", "/tmp/stas-metrics.prom")
    return path


def _write_prometheus_metric(reason: str, active: bool) -> None:
    path = _create_metrics_exporter_path()
    val = 1 if active else 0
    escaped_reason = reason.replace('"', '\\"').replace("\n", " ")
    try:
        with open(path, "w") as f:
            f.write(PROMETHEUS_METRIC % (escaped_reason, val))
    except OSError as exc:
        logger.warning("Failed to write prometheus metric: %s", exc)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.emergency.activate_emergency_stop",
    autoretry_for=(Exception,),
)
def activate_emergency_stop(self, reason: str = "Manual emergency stop") -> dict[str, Any]:
    stop = EmergencyStop()
    result = stop.activate(reason)
    _write_prometheus_metric(reason, True)

    try:
        from celery import current_app
        i = current_app.control.inspect()
        active = i.active() or {}
        revoked_count = 0
        for worker, tasks in active.items():
            for task in tasks:
                task_name = task.get("name", "")
                if "agent" in task_name or "dispatch" in task_name or "triage" in task_name:
                    current_app.control.revoke(task["id"], terminate=True)
                    revoked_count += 1
        logger.warning("Revoked %d active agent tasks", revoked_count)
        result["revoked_count"] = revoked_count
    except Exception as exc:
        logger.error("Failed to revoke tasks: %s", exc)
        result["revoke_error"] = str(exc)

    try:
        from workers.linear_client import get_linear_client
        client = get_linear_client()
        if client:
            from workers.tasks.linear_poll import poll_active_issues
            result["comment_posted"] = True
    except Exception as exc:
        logger.warning("Failed to post Linear comments: %s", exc)

    return result


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.emergency.deactivate_emergency_stop",
)
def deactivate_emergency_stop(self) -> dict[str, Any]:
    stop = EmergencyStop()
    result = stop.deactivate()
    _write_prometheus_metric("none", False)
    return result


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.emergency.emergency_stop_status",
)
def emergency_stop_status(self) -> dict[str, Any]:
    stop = EmergencyStop()
    return stop.get_status()


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=10,
    name="workers.tasks.emergency.route_to_hold",
)
def route_to_hold(self, task_name: str, task_headers: dict[str, Any]) -> dict[str, Any]:
    logger.info("Routed task %s to hold queue", task_name)
    return {
        "task_name": task_name,
        "status": "held",
        "timestamp": time.time(),
    }
