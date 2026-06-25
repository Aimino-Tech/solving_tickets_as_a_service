import logging
from typing import Any

from celery import signals

from workers.emergency.stop import EmergencyStop

logger = logging.getLogger(__name__)

AGENT_DISPATCH_TASKS = {
    "workers.tasks.agent.dispatch_opencode",
    "workers.tasks.linear_poll.triage",
    "workers.tasks.linear_poll.poll_active_issues",
    "workers.tasks.pipeline_orchestrator.orchestrate_pipeline",
}


def _task_should_be_blocked(task_name: str) -> bool:
    for pattern in AGENT_DISPATCH_TASKS:
        if task_name == pattern or task_name.startswith(pattern.rsplit(".", 1)[0]):
            return True
    return False


def before_task_publish_handler(headers: dict[str, Any] | None = None, body: Any = None, **kwargs: Any) -> None:
    if headers is None:
        return
    task_name = headers.get("task", "")
    if not _task_should_be_blocked(task_name):
        return

    stop = EmergencyStop()
    if stop.is_active():
        status = stop.get_status()
        logger.warning(
            "Blocking dispatch of %s — emergency stop active (reason: %s)",
            task_name, status["reason"],
        )
        from celery import current_app
        current_app.send_task(
            "workers.tasks.emergency.route_to_hold",
            args=[task_name, dict(headers)],
            queue="stas.emergency.hold",
        )
        raise Exception(f"Emergency stop active: {status['reason']}")


def task_prerun_handler(task_id: str, task: Any = None, **kwargs: Any) -> None:
    if task is None:
        return
    task_name = task.name
    if not _task_should_be_blocked(task_name):
        return

    stop = EmergencyStop()
    if stop.is_active():
        status = stop.get_status()
        logger.warning(
            "Revoking task %s — emergency stop active (reason: %s)",
            task_id, status["reason"],
        )
        from celery import current_app
        current_app.control.revoke(task_id, terminate=True)


def setup_emergency_hooks() -> None:
    signals.before_task_publish.connect(before_task_publish_handler)
    signals.task_prerun.connect(task_prerun_handler)
    logger.info("Emergency stop hooks registered")
