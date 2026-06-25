"""
Celery middleware for per-issue duplicate task prevention.

Hooks into Celery signals to acquire a Redis-backed dedup lock before
dispatch tasks run.  If the lock is already held (another worker is
processing the same issue), the duplicate task is silently Ignore'd.

Lock is released on task success or failure via signal handlers.
A TTL on the Redis key provides a safety net if release is missed
(e.g. worker crash).
"""

from __future__ import annotations

import logging
from typing import Any

from celery import signals
from celery.exceptions import Ignore

from workers.dispatch.dedup import get_dedup_manager

logger = logging.getLogger(__name__)

DEDUP_TASK_PATTERNS: set[str] = {
    "workers.tasks.agent.dispatch_opencode",
    "workers.tasks.linear_poll.triage",
    "workers.tasks.linear_poll.poll_active_issues",
    "workers.tasks.pipeline_orchestrator.orchestrate_pipeline",
}

_ALLOWED_TASKS: set[str] = {
    "workers.tasks.periodic.queue_health_check",
    "workers.tasks.periodic.dlq_cleanup",
    "workers.tasks.periodic.push_metrics",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.sandbox_gc.sandbox_gc",
    "workers.celery_app.ping",
}

_ACQUIRED_LOCKS: dict[str, str] = {}

_DEDUP_MANAGER: Any = None


def _get_dm():
    global _DEDUP_MANAGER
    if _DEDUP_MANAGER is None:
        _DEDUP_MANAGER = get_dedup_manager()
    return _DEDUP_MANAGER


def _extract_issue_id(task: Any, args: tuple, kwargs: dict) -> str | None:
    issue_id = kwargs.get("issue_id")
    if issue_id:
        return str(issue_id)

    ictx = kwargs.get("issue_context", {})
    if isinstance(ictx, dict):
        issue_id = ictx.get("issue_id")
        if issue_id:
            return str(issue_id)

    if args and isinstance(args[0], dict):
        issue_id = args[0].get("issue_id") or args[0].get("issue_url")
        if issue_id:
            return str(issue_id)

    return None


def _is_dispatch_task(task_name: str) -> bool:
    if task_name in _ALLOWED_TASKS:
        return False
    if task_name in DEDUP_TASK_PATTERNS:
        return True
    if task_name.startswith("workers.tasks.agent."):
        return True
    if task_name.startswith("workers.tasks.linear_poll."):
        return True
    if task_name.startswith("workers.tasks.pipeline_orchestrator."):
        return True
    return False


@signals.task_prerun.connect
def _dedup_before_dispatch(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    **signal_kwargs: Any,
) -> None:
    task_name = getattr(task, "name", None)
    if not task_name:
        return
    if not _is_dispatch_task(task_name):
        return

    issue_id = _extract_issue_id(task, args, kwargs)
    if not issue_id:
        return

    dm = _get_dm()
    if not dm.acquire(issue_id):
        logger.info(
            "Dedup blocked duplicate task=%s issue=%s task_id=%s",
            task_name,
            issue_id,
            task_id,
        )
        raise Ignore()

    _ACQUIRED_LOCKS[task_id] = issue_id


@signals.task_success.connect
def _dedup_release_on_success(
    sender: Any = None,
    task_id: str | None = None,
    **kwargs: Any,
) -> None:
    if not task_id:
        return
    issue_id = _ACQUIRED_LOCKS.pop(task_id, None)
    if issue_id:
        _get_dm().release(issue_id)


@signals.task_failure.connect
def _dedup_release_on_failure(
    sender: Any = None,
    task_id: str | None = None,
    **kwargs: Any,
) -> None:
    if not task_id:
        return
    issue_id = _ACQUIRED_LOCKS.pop(task_id, None)
    if issue_id:
        _get_dm().release(issue_id)


@signals.task_postrun.connect
def _dedup_release_on_postrun(
    sender: Any = None,
    task_id: str | None = None,
    **kwargs: Any,
) -> None:
    if not task_id:
        return
    issue_id = _ACQUIRED_LOCKS.pop(task_id, None)
    if issue_id:
        logger.warning(
            "Dedup lock not released via success/failure -- postrun cleanup issue=%s",
            issue_id,
        )
        _get_dm().release(issue_id)


def connect_dedup_middleware() -> None:
    logger.debug("Dedup middleware connected")
