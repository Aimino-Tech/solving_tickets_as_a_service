"""
Celery signal handlers for emergency stop enforcement.

Connects to ``task_prerun`` and ``task_postrun`` signals.  When the emergency
stop is active, any agent dispatch task is rejected (``Ignore``) instead of
executing.  Non-agent tasks (heartbeats, housekeeping, Celery internals)
are allowed through.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import signals
from celery.exceptions import Ignore

from workers.emergency.stop import get_emergency_stop

logger = logging.getLogger(__name__)

# ── Task routing ────────────────────────────────────────────────────────────

# Tasks that are always allowed even during emergency stop
_ALLOWED_TASKS: set[str] = {
    "workers.celery_app.ping",
    "workers.tasks.periodic.queue_health_check",
    "workers.tasks.periodic.dlq_cleanup",
    "workers.tasks.periodic.push_metrics",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.sandbox_gc.sandbox_gc",
}

# Task prefixes that are considered "agent dispatch" — these get blocked
_DISPATCH_PREFIXES: tuple[str, ...] = (
    "workers.tasks.triage.",
    "workers.tasks.agent.",
    "workers.tasks.sandbox.",
    "workers.tasks.verification.",
    "workers.tasks.pr_creation.",
    "workers.tasks.notifications.",
    "workers.tasks.linear_poll.",
    "workers.tasks.pipeline_orchestrator.",
)

_EMERGENCY_STOP: Any = None


def _get_es():
    global _EMERGENCY_STOP
    if _EMERGENCY_STOP is None:
        _EMERGENCY_STOP = get_emergency_stop()
    return _EMERGENCY_STOP


def _is_agent_task(task_name: str) -> bool:
    """Return ``True`` if *task_name* is an agent dispatch task."""
    if task_name in _ALLOWED_TASKS:
        return False
    return any(task_name.startswith(prefix) for prefix in _DISPATCH_PREFIXES)


# ── Signal handlers ─────────────────────────────────────────────────────────


@signals.task_prerun.connect
def _check_emergency_stop(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    **signal_kwargs: Any,
) -> None:
    """Reject agent tasks when the emergency stop is active.

    The task is silently ``Ignore``-ed (not retried).  Non-agent tasks
    (periodic housekeeping, health checks, etc.) are always allowed.
    """
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_agent_task(task_name):
        return

    if _get_es().check():
        logger.warning(
            "Emergency stop active — rejecting task=%s task_id=%s",
            task_name,
            task_id,
        )
        raise Ignore()


@signals.task_postrun.connect
def _log_emergency_stop_violation(
    task_id: str,
    task: Any,
    state: str,
    **signal_kwargs: Any,
) -> None:
    """Log any agent tasks that managed to run despite an active stop."""
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_agent_task(task_name):
        return

    if state == "IGNORED":
        return  # Already handled in _check_emergency_stop

    if _get_es().check():
        logger.error(
            "Emergency stop violation — task=%s task_id=%s state=%s ran despite stop",
            task_name,
            task_id,
            state,
        )


# ── Connection helper ───────────────────────────────────────────────────────


def connect_emergency_middleware() -> None:
    """Ensure the middleware signals are connected (no-op; module import suffices)."""
    logger.debug("Emergency stop middleware connected")
