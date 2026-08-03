"""Celery signal wiring — automatically logs audit events for task lifecycle."""

from __future__ import annotations

import logging
import os
from typing import Any

from workers.audit.trail import append_event

logger = logging.getLogger(__name__)

AUDIT_TENANT_ID = os.getenv("AUDIT_TENANT_ID", "syntaro-default")


def _extract_tenant(args: tuple, kwargs: dict) -> str:
    tenant = kwargs.get("tenant_id")
    if tenant:
        return tenant
    tenant = kwargs.get("issue_id")
    if tenant:
        return tenant
    if args and isinstance(args[0], str) and len(args[0]) > 4:
        return args[0]
    return AUDIT_TENANT_ID


def _on_task_prerun(
    task_name: str,
    task_id: str,
    args: tuple,
    kwargs: dict,
) -> None:
    tenant = _extract_tenant(args, kwargs)
    append_event(
        tenant_id=tenant,
        event_type="task.start",
        payload={
            "task_name": task_name,
            "task_id": task_id,
            "args_preview": [str(a)[:200] for a in args],
            "kwargs_keys": list(kwargs.keys()),
        },
    )


def _on_task_success(
    task_name: str,
    task_id: str,
    args: tuple,
    kwargs: dict,
    result: Any,
) -> None:
    tenant = _extract_tenant(args, kwargs)
    result_preview: Any = result
    if isinstance(result, dict):
        result_preview = {k: str(v)[:200] for k, v in result.items()}
    elif not isinstance(result, (str, int, float, bool, type(None))):
        result_preview = str(result)[:500]

    append_event(
        tenant_id=tenant,
        event_type="task.success",
        payload={
            "task_name": task_name,
            "task_id": task_id,
            "result": result_preview,
        },
    )


def _on_task_failure(
    task_name: str,
    task_id: str,
    args: tuple,
    kwargs: dict,
    exception: BaseException | None,
) -> None:
    tenant = _extract_tenant(args, kwargs)
    append_event(
        tenant_id=tenant,
        event_type="task.failure",
        payload={
            "task_name": task_name,
            "task_id": task_id,
            "error": str(exception) if exception else "Unknown error",
            "error_type": type(exception).__name__ if exception else "Unknown",
        },
    )


try:
    from celery.signals import task_failure, task_prerun, task_success

    @task_prerun.connect
    def _signal_task_prerun(
        sender=None,
        task_id=None,
        task=None,
        args=None,
        kwargs=None,
        **signal_kwargs,
    ) -> None:
        if task is None or task_id is None or args is None or kwargs is None:
            return
        try:
            _on_task_prerun(task.name, task_id, args, kwargs)
        except Exception:
            logger.exception("Audit: error in task_prerun handler")

    @task_success.connect
    def _signal_task_success(
        sender=None,
        result=None,
        **signal_kwargs,
    ) -> None:
        if sender is None:
            return
        from celery._state import get_current_task

        current = get_current_task()
        if current is None:
            return
        try:
            _on_task_success(
                current.name,
                current.request.id,
                current.request.args,
                current.request.kwargs,
                result,
            )
        except Exception:
            logger.exception("Audit: error in task_success handler")

    @task_failure.connect
    def _signal_task_failure(
        sender=None,
        task_id=None,
        exception=None,
        args=None,
        kwargs=None,
        **signal_kwargs,
    ) -> None:
        if sender is None or task_id is None:
            return
        try:
            _on_task_failure(
                sender.name,
                task_id,
                args or (),
                kwargs or {},
                exception,
            )
        except Exception:
            logger.exception("Audit: error in task_failure handler")

    logger.info("Audit middleware — Celery signal handlers connected")

except ImportError as exc:
    logger.warning("Audit middleware — Could not connect Celery signals: %s", exc)
