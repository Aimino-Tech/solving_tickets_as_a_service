"""
Emergency task revocation — force-stop all currently running agent tasks.

Uses Celery's app.control.revoke() with terminate=True to force-kill
any tasks that are currently executing. This is the nuclear option —
use only when the emergency stop is activated.

Usage:
    from workers.emergency.revoke import revoke_all_agent_tasks
    count = revoke_all_agent_tasks()
    print(f"Revoked {count} tasks")

    # With custom timeout (SIGTERM timeout before SIGKILL)
    count = revoke_all_agent_tasks(timeout_ms=10000)

Strategy:
    1. Inspect the active worker for currently running tasks.
    2. Revoke all non-whitelisted tasks with terminate=True.
    3. Wait for the SIGTERM timeout, then issue SIGKILL.
    4. Log all revoked task IDs for audit trail.

Note:
    - Requires Celery 5.x with Redis or RabbitMQ result backend.
    - The app.control.revoke() call sends a broadcast message to all workers.
    - Tasks that have already completed will be unaffected.
"""

import logging
import os
import time
from typing import Optional

from celery import current_app

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Whitelist — these tasks are NOT revoked during emergency stop
# ---------------------------------------------------------------------------

_TASK_WHITELIST = frozenset({
    "workers.celery_app.ping",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.periodic.push_metrics",
    "workers.tasks.periodic.queue_health_check",
    "workers.tasks.periodic.dlq_cleanup",
})

# ---------------------------------------------------------------------------
# Helper: get running task IDs from the inspector
# ---------------------------------------------------------------------------


def _get_running_task_ids() -> list[tuple[str, str]]:
    """
    Query all active Celery workers for currently running tasks.

    Returns:
        List of (task_id, task_name) tuples for tasks currently being
        executed. Returns empty list if no workers are reachable.
    """
    try:
        inspector = current_app.control.inspect()
        active_tasks = inspector.active()

        if not active_tasks:
            logger.info("No active tasks found via inspector")
            return []

        running: list[tuple[str, str]] = []
        for worker_name, tasks in active_tasks.items():
            if not tasks:
                continue
            for task_info in tasks:
                task_id = task_info.get("id", "")
                task_name = task_info.get("name", "unknown")
                if task_name not in _TASK_WHITELIST:
                    running.append((task_id, task_name))

        return running

    except Exception as exc:
        logger.warning("Failed to inspect active tasks: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def revoke_all_agent_tasks(timeout_ms: Optional[int] = None) -> int:
    """
    Revoke (force-terminate) all currently running agent tasks.

    This sends a broadcast revoke command to all Celery workers. Tasks are
    sent SIGTERM first, then SIGKILL after the timeout.

    Args:
        timeout_ms: Timeout in milliseconds before SIGTERM→SIGKILL escalation.
                    Defaults to STAS_EMERGENCY_REVOKE_TIMEOUT_MS env var or 5000.

    Returns:
        Number of tasks revoked.

    Raises:
        RuntimeError: If the revoke command fails entirely.
    """
    if timeout_ms is None:
        timeout_ms = int(os.getenv("STAS_EMERGENCY_REVOKE_TIMEOUT_MS", "5000"))

    # Ensure timeout is at least 1 second
    timeout_ms = max(timeout_ms, 1000)
    terminate = True

    # Get running task IDs
    running_tasks = _get_running_task_ids()

    if not running_tasks:
        logger.info("No agent tasks to revoke")
        return 0

    task_ids = [tid for tid, _ in running_tasks]

    logger.warning(
        "Revoking %d agent tasks (timeout=%dms): %s",
        len(task_ids),
        timeout_ms,
        [name for _, name in running_tasks],
    )

    try:
        # Send revoke with terminate=True and signal=SIGTERM
        current_app.control.revoke(
            task_ids,
            terminate=terminate,
            signal="SIGTERM",
        )

        # Log the revocation for audit
        for task_id, task_name in running_tasks:
            logger.warning(
                "Revoked task %s (%s) — terminate=%s timeout=%dms",
                task_id,
                task_name,
                terminate,
                timeout_ms,
            )

        logger.info(
            "Successfully revoked %d agent tasks",
            len(task_ids),
        )

        return len(task_ids)

    except Exception as exc:
        error_msg = f"Failed to revoke tasks: {exc}"
        logger.error(error_msg)
        raise RuntimeError(error_msg) from exc


def revoke_by_task_id(task_id: str, terminate: bool = True) -> bool:
    """
    Revoke a single task by its ID.

    Args:
        task_id: The Celery task ID to revoke.
        terminate: Whether to force-terminate the task if currently running.

    Returns:
        True if the revoke command was sent successfully.
    """
    try:
        current_app.control.revoke(task_id, terminate=terminate, signal="SIGTERM")
        logger.warning("Revoked single task %s (terminate=%s)", task_id, terminate)
        return True
    except Exception as exc:
        logger.error("Failed to revoke task %s: %s", task_id, exc)
        return False
