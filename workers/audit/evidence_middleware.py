"""Celery signal wiring for evidence receipts — captures agent lifecycle transitions.

Connects to Celery's task_prerun, task_success, and task_failure signals
to create cryptographically chained evidence receipts for every agent
lifecycle transition.
"""

from __future__ import annotations

import logging
from typing import Any

from workers.audit.evidence import capture_receipt

logger = logging.getLogger(__name__)

_TASK_CONTEXT: dict[str, dict[str, str]] = {}
_MAX_CONTEXT_ENTRIES = 10_000


def _get_agent_state(task_name: str) -> str:
    state_map = {
        "workers.tasks.triage.run_triage": "triage",
        "workers.tasks.agent.dispatch_agent": "agent_dispatch",
        "workers.tasks.sandbox.run_sandbox": "sandbox",
        "workers.tasks.verification.run_verification": "verification",
        "workers.tasks.pr_creation.create_pr": "pr_creation",
        "workers.tasks.notifications.send_notification": "notification",
        "workers.celery_app.ping": "health_check",
    }
    if task_name in state_map:
        return state_map[task_name]
    parts = task_name.rsplit(".", 1)
    return parts[-1] if len(parts) > 1 else task_name


def _extract_workflow_id(args: tuple, kwargs: dict) -> str | None:
    for key in ("workflow_id", "pipeline_id"):
        value = kwargs.get(key)
        if value:
            return str(value)
    for ctx_key in ("pipeline_context", "issue_context", "context"):
        ctx = kwargs.get(ctx_key)
        if isinstance(ctx, dict):
            value = ctx.get("workflow_id") or ctx.get("pipeline_id")
            if value:
                return str(value)
    return None


def _extract_issue_id(args: tuple, kwargs: dict) -> str | None:
    issue_id = kwargs.get("issue_id")
    if issue_id:
        return str(issue_id)
    for ctx_key in ("pipeline_context", "issue_context", "context"):
        ctx = kwargs.get(ctx_key)
        if isinstance(ctx, dict):
            value = ctx.get("issue_id") or ctx.get("issue_identifier")
            if value:
                return str(value)
    for arg in args:
        if isinstance(arg, dict):
            value = arg.get("issue_id") or arg.get("issue_identifier")
            if value:
                return str(value)
    return None


def _extract_tenant(args: tuple, kwargs: dict) -> str:
    tenant = kwargs.get("tenant_id")
    if tenant:
        return str(tenant)
    for ctx_key in ("pipeline_context", "issue_context", "context"):
        ctx = kwargs.get(ctx_key)
        if isinstance(ctx, dict):
            value = ctx.get("tenant_id")
            if value:
                return str(value)
    if args and isinstance(args[0], str) and len(args[0]) > 4:
        return str(args[0])
    return "stas-default"


def _cache_task_context(task_id: str, workflow_id: str | None, issue_id: str | None, tenant_id: str) -> None:
    if len(_TASK_CONTEXT) >= _MAX_CONTEXT_ENTRIES:
        try:
            oldest = next(iter(_TASK_CONTEXT))
            _TASK_CONTEXT.pop(oldest, None)
        except StopIteration:
            pass
    _TASK_CONTEXT[task_id] = {
        "workflow_id": workflow_id or "",
        "issue_id": issue_id or "",
        "tenant_id": tenant_id,
    }


def _get_cached_context(task_id: str) -> dict[str, str]:
    return _TASK_CONTEXT.pop(task_id, {})


# ---- Signal handlers --------------------------------------------------------


def _on_task_prerun(task_name: str, task_id: str, args: tuple, kwargs: dict) -> None:
    workflow_id = _extract_workflow_id(args, kwargs)
    issue_id = _extract_issue_id(args, kwargs)
    tenant_id = _extract_tenant(args, kwargs)
    _cache_task_context(task_id, workflow_id, issue_id, tenant_id)
    agent_state = _get_agent_state(task_name)
    capture_receipt(
        workflow_id=workflow_id or task_id,
        transition="task.start",
        agent_state=agent_state,
        tenant_id=tenant_id,
        issue_id=issue_id,
        task_id=task_id,
        payload={"task_name": task_name, "kwargs_keys": list(kwargs.keys())},
    )


def _on_task_success(task_name: str, task_id: str, args: tuple, kwargs: dict, result: Any) -> None:
    ctx = _get_cached_context(task_id)
    workflow_id = ctx.get("workflow_id") or _extract_workflow_id(args, kwargs)
    issue_id = ctx.get("issue_id") or _extract_issue_id(args, kwargs)
    tenant_id = ctx.get("tenant_id") or _extract_tenant(args, kwargs)
    agent_state = _get_agent_state(task_name)
    result_preview: Any = result
    if isinstance(result, dict):
        result_preview = {k: str(v)[:200] for k, v in result.items()}
    elif not isinstance(result, (str, int, float, bool, type(None))):
        result_preview = str(result)[:500]
    capture_receipt(
        workflow_id=workflow_id or task_id,
        transition="task.success",
        agent_state=agent_state,
        previous_state=agent_state,
        tenant_id=tenant_id,
        issue_id=issue_id,
        task_id=task_id,
        payload={"task_name": task_name, "result": result_preview},
    )


def _on_task_failure(task_name: str, task_id: str, args: tuple, kwargs: dict, exception: BaseException | None) -> None:
    ctx = _get_cached_context(task_id)
    workflow_id = ctx.get("workflow_id") or _extract_workflow_id(args, kwargs)
    issue_id = ctx.get("issue_id") or _extract_issue_id(args, kwargs)
    tenant_id = ctx.get("tenant_id") or _extract_tenant(args, kwargs)
    agent_state = _get_agent_state(task_name)
    capture_receipt(
        workflow_id=workflow_id or task_id,
        transition="task.failure",
        agent_state=agent_state,
        previous_state=agent_state,
        tenant_id=tenant_id,
        issue_id=issue_id,
        task_id=task_id,
        payload={
            "task_name": task_name,
            "error": str(exception) if exception else "Unknown error",
            "error_type": type(exception).__name__ if exception else "Unknown",
        },
    )


# ---- Celery signal connection -----------------------------------------------


def connect_evidence_middleware() -> None:
    try:
        from celery.signals import task_failure, task_prerun, task_success

        @task_prerun.connect
        def _signal_task_prerun(sender=None, task_id=None, task=None, args=None, kwargs=None, **signal_kwargs) -> None:
            if task is None or task_id is None or args is None or kwargs is None:
                return
            try:
                _on_task_prerun(task.name, task_id, args, kwargs)
            except Exception:
                logger.exception("Evidence: error in task_prerun handler")

        @task_success.connect
        def _signal_task_success(sender=None, result=None, **signal_kwargs) -> None:
            if sender is None:
                return
            from celery._state import get_current_task
            current = get_current_task()
            if current is None:
                return
            try:
                _on_task_success(current.name, current.request.id, current.request.args, current.request.kwargs, result)
            except Exception:
                logger.exception("Evidence: error in task_success handler")

        @task_failure.connect
        def _signal_task_failure(sender=None, task_id=None, exception=None, args=None, kwargs=None, **signal_kwargs) -> None:
            if sender is None or task_id is None:
                return
            try:
                _on_task_failure(sender.name, task_id, args or (), kwargs or {}, exception)
            except Exception:
                logger.exception("Evidence: error in task_failure handler")

        logger.info("Evidence middleware \u2014 Celery signal handlers connected")

    except ImportError as exc:
        logger.warning("Evidence middleware \u2014 Could not connect Celery signals: %s", exc)
