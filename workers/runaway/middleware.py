"""
Celery signal handlers for runaway agent enforcement.

Connects to ``task_prerun`` and ``task_postrun`` signals.  On ``task_prerun``
the handler:

  1. Records the task start time (if not already tracked).
  2. Checks timeout, token, and cost limits.
  3. If any limit is exceeded, raises ``Ignore`` to silently kill the task
     (matching the pattern used by ``emergency.middleware``).

On ``task_postrun`` the handler cleans up tracking state.

Agent dispatch tasks are the primary target (same set as emergency middleware).
"""

from __future__ import annotations

import logging
from typing import Any

from celery import signals
from celery.exceptions import Ignore

from workers.runaway.guard import get_runaway_guard

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Task routing — same set as emergency middleware
# ---------------------------------------------------------------------------

# Tasks that are always allowed (housekeeping, health checks, etc.)
_ALLOWED_TASKS: set[str] = {
    "workers.celery_app.ping",
    "workers.tasks.periodic.queue_health_check",
    "workers.tasks.periodic.dlq_cleanup",
    "workers.tasks.periodic.push_metrics",
    "workers.tasks.periodic.report_liveness",
    "workers.tasks.sandbox_gc.sandbox_gc",
    "workers.billing.usage.sync_usage_to_stripe",
}

# Task prefixes that are subject to runaway protection
_DISPATCH_PREFIXES: tuple[str, ...] = (
    "workers.tasks.triage.",
    "workers.tasks.agent.",
    "workers.tasks.sandbox.",
    "workers.tasks.verification.",
    "workers.tasks.pr_creation.",
    "workers.tasks.notifications.",
    "workers.tasks.linear_poll.",
    "workers.tasks.pipeline_orchestrator.",
    "workers.tasks.merge_queue.",
    "workers.tasks.build_verify.",
    "workers.tasks.ci_polling.",
    "workers.tasks.dependency_resolver.",
    "workers.tasks.human_escalation.",
    "workers.tasks.multi_verification.",
    "workers.tasks.review_orchestrator.",
    "workers.tasks.visual_verification.",
    "workers.tasks.ticket_expander.",
    "workers.tasks.anti_liar.",
    "workers.tasks.auto_qa.",
    "workers.tasks.adversarial_review.",
    "workers.tasks.self_audit.",
    "workers.orchestrator.",
    "workers.quality.",
    "workers.merge_queue.",
)

_GUARD: Any = None


def _get_guard():
    global _GUARD
    if _GUARD is None:
        _GUARD = get_runaway_guard()
    return _GUARD


def _is_agent_task(task_name: str) -> bool:
    """Return ``True`` if *task_name* is subject to runaway protection."""
    if task_name in _ALLOWED_TASKS:
        return False
    return any(task_name.startswith(prefix) for prefix in _DISPATCH_PREFIXES)


def _get_session_id(task_id: str, kwargs: dict) -> str:
    """Derive a session ID from kwargs, falling back to the Celery ``task_id``.

    When a pipeline run shares a session across multiple tasks, the caller
    should include ``session_id`` in kwargs.
    """
    return kwargs.get("session_id") or kwargs.get("pipeline_id") or task_id


# ---------------------------------------------------------------------------
# Signal handlers
# ---------------------------------------------------------------------------


@signals.task_prerun.connect
def _check_runaway_before_task(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    **signal_kwargs: Any,
) -> None:
    """Check runaway limits before a task executes.

    Connected automatically via the ``@signals.task_prerun.connect``
    decorator.  Just importing this module activates it.

    Steps:
      1. Skip non-agent tasks.
      2. Mark the task start time (first call only — subsequent retries
         preserve the original start).
      3. Run all checks (timeout, tokens, cost).
      4. If any limit is exceeded, raise ``Ignore``.
    """
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_agent_task(task_name):
        return

    guard = _get_guard()

    # Mark the start time if not already tracked (first invocation or retry)
    elapsed = guard.get_elapsed(task_id)
    if elapsed is None:
        guard.mark_start(task_id)

    # Run all checks
    exceeded, reason = guard.check_all(task_id, task_name, args, kwargs)
    if exceeded:
        logger.warning(
            "Runaway guard blocked task=%s task_id=%s reason=%s",
            task_name,
            task_id,
            reason,
        )
        raise Ignore()


@signals.task_postrun.connect
def _cleanup_after_task(
    task_id: str,
    task: Any,
    state: str,
    **signal_kwargs: Any,
) -> None:
    """Clean up runaway tracking state after a task completes.

    Only cleanup agent tasks that succeeded or were rejected (``IGNORED``).
    Failed tasks keep their tracking data so the retry mechanism works.
    """
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if not _is_agent_task(task_name):
        return

    if state in ("SUCCESS", "IGNORED"):
        guard = _get_guard()
        guard.mark_complete(task_id)
        logger.debug(
            "Cleaned up runaway tracking — task=%s task_id=%s state=%s",
            task_name,
            task_id,
            state,
        )


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------


def connect_runaway_middleware() -> None:
    """Ensure the middleware signals are connected (no-op; module import suffices)."""
    logger.info("Runaway agent middleware connected")
