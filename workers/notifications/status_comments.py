"""
Real-time Linear status comments for pipeline stage transitions.

Posts comments to Linear issues with emoji-prefixed stage labels as each
pipeline stage starts, completes, or fails.  Completed stages within a
5-second window are coalesced into a single comment to avoid flooding the
issue with noise.

Config
------
``STAS_STATUS_COMMENTS_ENABLED`` (env var, default ``"true"``):
    Set to ``"false"`` to disable all status comments globally.

Usage
-----
Direct call::

    from workers.notifications.status_comments import post_stage_comment

    post_stage_comment("AIM-42", "triage", "started", "Triaging issue")

Automatic via Celery signals (connected on import)::

    # Importing this module connects ``task_after_return``,
    # ``task_prerun``, and ``task_failure`` signals that map known
    # task names to pipeline stages and post comments automatically.
    import workers.notifications.status_comments  # noqa: F401

Stage identifiers and their emoji prefixes:

    =============  =====  =============    Stage          Emoji  Label
    =============  =====  =============    triage         📋     Triage
    research       🔍     Research
    agent          🤖     Agent
    verify         🧪     Verify
    self_audit     🔬     Self-Audit
    review         👁️     Review
    pr             🔄     PR
    failed         ❌     Failed
    =============  =====  ============="""

from __future__ import annotations

import logging
import os
from typing import Any

from workers.notifications.coalescer import StageCoalescer
from workers.notifications.snippets import (
    get_evidence,
    format_evidence_section,
)
from workers.notifications.progressive import STAGE_ORDER, build_progressive_comment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Emoji / label maps
# ---------------------------------------------------------------------------

STAGE_EMOJI: dict[str, str] = {
    "triage": "\U0001f4cb",      # 📋
    "research": "\U0001f50d",    # 🔍
    "agent": "\U0001f916",       # 🤖
    "verify": "\U0001f9ea",      # 🧪
    "self_audit": "\U0001f52c",  # 🔬
    "review": "\U0001f441\ufe0f",  # 👁️
    "pr": "\U0001f504",          # 🔄
    "failed": "\u274c",          # ❌
}

STAGE_LABELS: dict[str, str] = {
    "triage": "Triage",
    "research": "Research",
    "agent": "Agent",
    "verify": "Verify",
    "self_audit": "Self-Audit",
    "review": "Review",
    "pr": "PR",
}

# Known task name -> stage mapping. Extend this when new pipeline tasks are
# added to ``workers.orchestrator.pipelines``.
TASK_STAGE_MAP: dict[str, str] = {
    "workers.tasks.triage.triage_issue": "triage",
    "workers.orchestrator.workspace.create_workspace": "research",
    "workers.tasks.agent.dispatch_opencode": "agent",
    "workers.tasks.verification.run_verification": "verify",
    "workers.tasks.self_audit.run_self_audit": "self_audit",
    "workers.quality.anti_mockup_scan.anti_mockup_scan": "self_audit",
    "workers.tasks.pr_creation.create_pull_request": "pr",
    "workers.tasks.notifications.dispatch_webhook_event": "review",
    "workers.tasks.self_audit.review_decision": "review",
}

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

STATUS_COMMENTS_ENABLED = os.getenv(
    "STAS_STATUS_COMMENTS_ENABLED", "true",
).lower() in ("true", "1", "yes")

# ---------------------------------------------------------------------------
# Progressive-comment state (per-issue)
# ---------------------------------------------------------------------------

_issue_states: dict[str, dict[str, dict[str, Any]]] = {}
_issue_comment_ids: dict[str, str] = {}

# ---------------------------------------------------------------------------
# Coalescer singleton
# ---------------------------------------------------------------------------

_coalescer: StageCoalescer | None = None
_spam_filter: CommentSpamFilter | None = None


def _get_coalescer() -> StageCoalescer:
    """Return the shared ``StageCoalescer`` singleton."""
    global _coalescer
    if _coalescer is None:
        _coalescer = StageCoalescer(
            window_seconds=5.0,
            flush_callback=_flush_coalesced_events,
        )
    return _coalescer


def _get_spam_filter() -> CommentSpamFilter:
    """Return the shared ``CommentSpamFilter`` singleton."""
    global _spam_filter
    if _spam_filter is None:
        _spam_filter = CommentSpamFilter(
            coalesce_window_seconds=10.0,
            dedup_window_seconds=30.0,
            flush_callback=_flush_coalesced_events,
        )
    return _spam_filter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_message(
    stage: str,
    status: str,
    message: str,
    issue_id: str | None = None,
) -> str:
    """Format a single stage status update as a comment body."""
    emoji = STAGE_EMOJI.get(stage, "\u2022")  # bullet fallback
    label = STAGE_LABELS.get(stage, stage.title())
    body = f"{emoji} **{label}**: {message}"

    if issue_id:
        evidence = get_evidence(issue_id, stage)
        if evidence:
            body += format_evidence_section(evidence)

    return body


def _sanitize_error(error: str, max_length: int = 500) -> str:
    """Truncate and sanitize an error message for public display."""
    if not error:
        return "Unknown error"
    # Strip potentially sensitive details (file paths, stack traces)
    sanitized = error.split("\n")[0].strip()
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."
    return sanitized


# ---------------------------------------------------------------------------
# Flush callback (called by the coalescer's timer thread)
# ---------------------------------------------------------------------------


def _flush_coalesced_events(events: list[dict[str, Any]]) -> None:
    """Rebuild and update the progressive comment with coalesced events.

    Called from the ``StageCoalescer`` timer thread when the idle window
    expires.  Builds a full progressive comment from the current in-memory
    stage state and updates the single evolving comment in place.

    The *events* argument determines which issue IDs need an update; the
    actual comment content is derived from :data:`_issue_states`.
    """
    if not events:
        return

    issue_ids = {e["issue_id"] for e in events}
    for issue_id in issue_ids:
        if issue_id not in _issue_states:
            _issue_states[issue_id] = {}
        for e in events:
            if e["issue_id"] == issue_id:
                _issue_states[issue_id][e["stage"]] = {
                    "stage": e["stage"],
                    "status": e["status"],
                    "message": e["message"],
                }

        body = build_progressive_comment(issue_id, _issue_states[issue_id])
        _post_to_linear(issue_id, body)
        logger.info(
            "Updated progressive comment issue=%s (from %d coalesced event(s))",
            issue_id, sum(1 for e in events if e["issue_id"] == issue_id),
        )


def _post_to_linear(issue_id: str, body: str) -> None:
    """Post or update a progressive comment for *issue_id*.

    If a comment ID has already been recorded for this issue the existing
    comment is updated in place.  Otherwise a new comment is created and
    its ID is cached for future updates.

    Silently catches errors to avoid breaking the pipeline.
    """
    try:
        from workers.linear.client import post_comment, update_comment

        comment_id = _issue_comment_ids.get(issue_id)
        if comment_id:
            update_comment(comment_id, body)
            logger.debug(
                "Updated progressive comment issue=%s comment=%s",
                issue_id, comment_id,
            )
        else:
            result = post_comment(issue_id, body)
            new_id = (
                result.get("commentCreate", {})
                .get("comment", {})
                .get("id")
            )
            if new_id:
                _issue_comment_ids[issue_id] = new_id
                logger.info(
                    "Created progressive comment issue=%s comment=%s",
                    issue_id, new_id,
                )
            else:
                logger.warning(
                    "Could not extract comment ID from response issue=%s",
                    issue_id,
                )
    except Exception as exc:
        logger.warning(
            "Failed to post/update Linear comment issue=%s: %s",
            issue_id, exc,
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def post_stage_comment(
    issue_id: str,
    stage: str,
    status: str,
    message: str,
) -> dict[str, Any]:
    """Post a progressive status comment for a pipeline stage transition.

    Uses a single evolving comment that shows the full pipeline state:
    completed stages are collapsed, the current stage is expanded with a
    progress bar, and pending stages are grayed out.

    Parameters
    ----------
    issue_id:
        Linear issue ID (e.g. ``"lin_abc123"``).
    stage:
        Stage identifier (``"triage"``, ``"agent"``, ``"verify"``, etc.).
    status:
        One of ``"started"``, ``"completed"``, ``"failed"``.
    message:
        Human-readable status message.

    Returns
    -------
    A result dict with keys ``status`` (``"posted"``, ``"coalesced"``,
    ``"disabled"``, or ``"error"``) and optional ``error`` message.

    Notes
    -----
    - Completed stages are coalesced (batched in a 5 s window).  Start and
      failure statuses are posted immediately.
    - A single comment per issue is updated in place every time a status
      changes, so the issue thread always contains exactly one pipeline
      progress comment.
    - When ``STATUS_COMMENTS_ENABLED`` is ``False``, all calls are no-ops.
    """
    if not STATUS_COMMENTS_ENABLED:
        logger.debug("Status comments disabled - skipping stage=%s issue=%s", stage, issue_id)
        return {"status": "disabled"}

    if issue_id not in _issue_states:
        _issue_states[issue_id] = {}
    _issue_states[issue_id][stage] = {
        "stage": stage,
        "status": status,
        "message": message,
    }

    if status == "completed":
        coalescer = _get_coalescer()
        coalescer.add_event(issue_id, stage, status, message)
        return {"status": "coalesced"}

    if status == "failed":
        message = _sanitize_error(message)
        _issue_states[issue_id][stage]["message"] = message

    body = build_progressive_comment(issue_id, _issue_states[issue_id])
    try:
        _post_to_linear(issue_id, body)
        logger.info("Posted progressive %s comment issue=%s stage=%s", status, issue_id, stage)
        return {"status": "posted"}
    except Exception as exc:
        logger.warning("Failed to post progressive %s comment issue=%s: %s", status, issue_id, exc)
        return {"status": "error", "error": str(exc)}

def set_enabled(enabled: bool) -> None:
    """Enable or disable status comments at runtime (test helper)."""
    global STATUS_COMMENTS_ENABLED
    STATUS_COMMENTS_ENABLED = enabled


# ====================================================================# Celery signal handlers
#
# These connect at import time and automatically post status comments when
# known pipeline-stage tasks start, complete, or fail.
# ====================================================================

def _extract_issue_id(args: tuple, kwargs: dict) -> str | None:
    """Try to extract ``issue_id`` from a task's args or kwargs.

    Checks (in order):
      1. ``kwargs["issue_id"]``
      2. ``kwargs.get("pipeline_context", {})["issue_id"]``
      3. ``kwargs.get("issue_context", {})["issue_id"]``
      4. First dict positional arg's ``"issue_id"`` key
    """
    issue_id = kwargs.get("issue_id")
    if issue_id:
        return issue_id

    # Check nested context objects
    for ctx_key in ("pipeline_context", "issue_context", "context"):
        ctx = kwargs.get(ctx_key)
        if isinstance(ctx, dict):
            issue_id = ctx.get("issue_id") or ctx.get("issue_identifier")
            if issue_id:
                return issue_id

    # Check first dict positional arg
    for arg in args:
        if isinstance(arg, dict):
            issue_id = arg.get("issue_id") or arg.get("issue_identifier")
            if issue_id:
                return issue_id

    return None


def _resolve_stage(task_name: str) -> str | None:
    """Map a Celery task name to a pipeline stage, or return ``None``."""
    return TASK_STAGE_MAP.get(task_name)


# ---- Signal handlers ------------------------------------------------------


def _on_task_prerun(task_name: str, args: tuple, kwargs: dict) -> None:
    """Called before a task executes.  Posts a 'started' comment."""
    stage = _resolve_stage(task_name)
    if stage is None:
        return
    issue_id = _extract_issue_id(args, kwargs)
    if not issue_id:
        logger.debug("No issue_id found for task %s \u2014 skipping prerun comment", task_name)
        return
    label = STAGE_LABELS.get(stage, stage.title())
    post_stage_comment(issue_id, stage, "started", f"{label} stage started")


def _on_task_success(task_name: str, args: tuple, kwargs: dict, result: Any) -> None:
    """Called after a task completes successfully.  Posts a 'completed' comment."""
    stage = _resolve_stage(task_name)
    if stage is None:
        return
    issue_id = _extract_issue_id(args, kwargs)
    if not issue_id:
        return

    # Build a meaningful summary from the result
    if isinstance(result, dict):
        summary = _summarize_result(result)
    else:
        summary = f"Completed with status: {result}"

    post_stage_comment(issue_id, stage, "completed", summary)


def _on_task_failure(task_name: str, args: tuple, kwargs: dict, exception: BaseException) -> None:
    """Called after a task fails.  Posts a 'failed' comment."""
    stage = _resolve_stage(task_name)
    if stage is None:
        return
    issue_id = _extract_issue_id(args, kwargs)
    if not issue_id:
        return

    error_msg = str(exception) if exception else "Unknown failure"
    post_stage_comment(issue_id, stage, "failed", error_msg)


def _summarize_result(result: dict[str, Any]) -> str:
    """Build a one-line summary from a task result dict."""
    # Common result keys across pipeline tasks
    status_keys = ("status", "passed", "decision", "result")
    for key in status_keys:
        value = result.get(key)
        if value is not None:
            if isinstance(value, str):
                return value
            return str(value)

    # Fallback: use the first non-empty string value
    for value in result.values():
        if isinstance(value, str) and value:
            return value[:120]  # keep it short

    return "Stage completed"


# ====================================================================# Connect Celery signals
#
# We connect to the low-level ``before_task_publish`` and
# ``after_task_publish`` signals to capture args/kwargs, and to
# ``task_failure`` for error handling.
#
#   - ``task_prerun``   → posts "started" comment
#   - ``task_success``   → coalesces "completed" comment
#   - ``task_failure``   → posts immediate "failed" comment
# ====================================================================
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
        if task is None or args is None or kwargs is None:
            return
        _on_task_prerun(task.name, args, kwargs)

    @task_success.connect
    def _signal_task_success(
        sender=None,
        result=None,
        **signal_kwargs,
    ) -> None:
        if sender is None:
            return
        # task_success doesn't provide args/kwargs, but we can retrieve
        # the current task from the thread-local state.
        from celery._state import get_current_task

        current = get_current_task()
        if current is None:
            return
        try:
            _on_task_success(current.name, current.request.args, current.request.kwargs, result)
        except Exception:
            logger.exception("Error in task_success signal handler")

    @task_failure.connect
    def _signal_task_failure(
        sender=None,
        task_id=None,
        exception=None,
        args=None,
        kwargs=None,
        **signal_kwargs,
    ) -> None:
        if sender is None:
            return
        _on_task_failure(sender.name, args or (), kwargs or {}, exception)

    logger.debug(
        "Status-comment Celery signal handlers connected "
        "(enabled=%s, stages=%d)",
        STATUS_COMMENTS_ENABLED,
        len(TASK_STAGE_MAP),
    )

except ImportError as exc:
    logger.warning("Could not connect Celery signals: %s", exc)
