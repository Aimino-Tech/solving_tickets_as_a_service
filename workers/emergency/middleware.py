"""
Celery task_prerun signal handler for emergency stop.

When the kill switch is active, this handler prevents any new tasks from
starting execution. The task is rejected (with requeue=False) so it won't
be redelivered to another worker.

This module mirrors the TypeScript middleware in src/emergency/middleware.ts.

Usage:
    # In celery_app.py or any module loaded at worker startup:
    from workers.emergency.middleware import emergency_prerun
    from celery import signals
    signals.task_prerun.connect(emergency_prerun)

    # Or connect with a specific sender/app instance:
    signals.task_prerun.connect(emergency_prerun, sender=app)

Notes:
    - The handler uses `RejectTask` to prevent the task from executing.
      Tasks that are rejected with requeue=False will go to the DLQ.
    - Whitelist certain system tasks (ping, heartbeat) that should always run.
    - Logs a warning when a task is blocked due to emergency stop.
"""

import logging

from celery.exceptions import Reject

from workers.emergency.stop import EmergencyStop

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task whitelist — these tasks always execute, even during emergency stop
# ---------------------------------------------------------------------------

_TASK_WHITELIST = frozenset({
    "workers.celery_app.ping",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.periodic.push_metrics",
})

# ---------------------------------------------------------------------------
# Signal handler
# ---------------------------------------------------------------------------


def emergency_prerun(task_id: str, task, **kwargs):
    """
    Celery task_prerun signal handler.

    Checks the emergency stop before allowing a task to execute. If the stop
    is active and the task is not whitelisted, the task is rejected with
    requeue=False and a warning is logged.

    Args:
        task_id: The unique ID of the task about to run.
        task: The task class instance.
        **kwargs: Additional keyword arguments from Celery (unused).
    """
    task_name = task.name if task else "unknown"

    # Always allow whitelisted system tasks
    if task_name in _TASK_WHITELIST:
        return

    # Check emergency stop (uses cached result for performance)
    if EmergencyStop.check():
        logger.warning(
            "Emergency stop active — rejecting task %s (%s)",
            task_id,
            task_name,
        )

        # Reject the task so it won't be retried by another worker.
        # The task will eventually end up in the DLQ.
        raise Reject(message="Emergency stop active", requeue=False)


def emergency_prerun_soft(task_id: str, task, **kwargs):
    """
    Alternative signal handler that raises a soft exception instead of
    hard-rejecting the task. Use this if you want tasks to be retried
    automatically when the stop is deactivated.

    Unlike `emergency_prerun`, this does NOT use `Reject` — it simply
    raises an exception that Celery will retry according to the task's
    retry policy.
    """
    task_name = task.name if task else "unknown"

    if task_name in _TASK_WHITELIST:
        return

    if EmergencyStop.check():
        logger.warning(
            "Emergency stop active — aborting task %s (%s) with retry",
            task_id,
            task_name,
        )
        raise RuntimeError(
            f"Emergency stop active — all agents halted. "
            f"Task {task_name} ({task_id}) will retry."
        )
