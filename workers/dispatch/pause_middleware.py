from __future__ import annotations
import logging
import os
from typing import Any
from celery import signals
from celery.exceptions import Ignore
from workers.dispatch.pause import get_pause_manager

logger = logging.getLogger(__name__)

DISPATCH_TASK_PATTERNS: set[str] = {
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

_PAUSE_MANAGER = None

def _get_pm():
    global _PAUSE_MANAGER
    if _PAUSE_MANAGER is None:
        _PAUSE_MANAGER = get_pause_manager()
    return _PAUSE_MANAGER

def _extract_project_slug(task: Any, args: tuple, kwargs: dict) -> str | None:
    slug = kwargs.get("project_slug")
    if slug:
        return slug
    ctx = kwargs.get("issue_context", {})
    if isinstance(ctx, dict):
        slug = ctx.get("project_slug") or ctx.get("repo_full_name")
        if slug:
            return slug
    ident = kwargs.get("identifier", "")
    if ident and "-" in ident:
        return ident.split("-", 1)[0].lower()
    return None

def _is_dispatch_task(task_name: str) -> bool:
    if task_name in _ALLOWED_TASKS:
        return False
    if task_name in DISPATCH_TASK_PATTERNS:
        return True
    if task_name.startswith("workers.tasks.agent."):
        return True
    if task_name.startswith("workers.tasks.linear_poll."):
        return True
    if task_name.startswith("workers.tasks.pipeline_orchestrator."):
        return True
    return False

@signals.task_prerun.connect
def _check_pause_before_dispatch(task_id: str, task: Any, args: tuple, kwargs: dict, **signal_kwargs: Any) -> None:
    task_name = getattr(task, "name", None)
    if not task_name:
        return
    if not _is_dispatch_task(task_name):
        return
    slug = _extract_project_slug(task, args, kwargs)
    if not slug:
        return
    if _get_pm().is_paused(slug):
        logger.info("Blocked dispatch task=%s project=%s task_id=%s paused", task_name, slug, task_id)
        raise Ignore()

def connect_pause_middleware() -> None:
    logger.debug("Pause middleware connected")
