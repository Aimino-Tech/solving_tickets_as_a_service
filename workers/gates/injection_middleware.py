"""
Celery signal-based middleware for prompt injection detection.

Automatically connects to the ``task_prerun`` signal at import time
to scan issue data for injection patterns before the triage LLM
prompt is built.

Two-step wiring (same as ``pause_middleware``):

1. Import this module anywhere in the worker process (it self-registers
   via the ``@signals.task_prerun.connect`` decorator).
2. Call ``connect_injection_middleware()`` to acknowledge the connection
   in logs.

Usage in ``celery_app.py``::

    from workers.gates import injection_middleware  # noqa: F401
"""

from __future__ import annotations

import logging
import os
from typing import Any

from celery import signals
from celery.exceptions import Ignore

from workers.gates.injection_guard import InjectionGuard, InjectionGuardConfig, InjectionGuardResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tasks the middleware scans
# ---------------------------------------------------------------------------

_TARGET_TASKS: set[str] = {
    "workers.tasks.triage.triage_issue",
    "workers.tasks.agent.dispatch_opencode",
}

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_CONFIG: InjectionGuardConfig | None = None


def _get_config() -> InjectionGuardConfig:
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = InjectionGuardConfig()
    return _CONFIG


# ---------------------------------------------------------------------------
# Linear comment helper
# ---------------------------------------------------------------------------

_comment_cache: set[str] = set()


def _post_injection_comment(issue_id: str, result: InjectionGuardResult, config: InjectionGuardConfig) -> None:
    """Post a comment to Linear notifying about detected injection.

    Deduplicates by issue_id so the same issue only gets one comment.
    In silent_annotate mode, only logs — no comment posted.
    """
    if issue_id in _comment_cache:
        return
    _comment_cache.add(issue_id)

    if config.silent_annotate:
        logger.info(
            "Injection detected for %s (silent annotate) — severity=%s score=%.2f",
            issue_id,
            result.severity,
            result.score,
        )
        return

    try:
        from workers.linear.client import post_comment

        patterns_str = ", ".join(result.patterns_matched)
        severity = result.severity
        score = result.score
        annotation = result.caution_annotation()

        if severity in ("critical", "high"):
            body = (
                f"### 🚨 Prompt Injection Detected\n\n"
                f"**STAS** has detected a potential prompt injection attempt "
                f"in this issue.\n\n"
                f"- **Severity**: {severity}\n"
                f"- **Score**: {score:.2f}\n"
                f"- **Patterns**: `{patterns_str}`\n\n"
                f"**{annotation}**\n\n"
                f"This issue requires **human intervention**."
            )
        else:
            body = (
                f"### ⚠️ Potential Prompt Injection\n\n"
                f"**STAS** has flagged a possible prompt injection pattern.\n\n"
                f"- **Severity**: {severity}\n"
                f"- **Score**: {score:.2f}\n"
                f"- **Patterns**: `{patterns_str}`\n\n"
                f"**{annotation}**\n\n"
                f"Pipeline will continue with caution."
            )

        post_comment(issue_id, body)
        logger.info("Posted injection detection comment for issue %s", issue_id)
    except Exception as exc:
        logger.warning("Failed to post injection comment for %s: %s", issue_id, exc)


# ---------------------------------------------------------------------------
# Scan helper
# ---------------------------------------------------------------------------


def _extract_text(kwargs: dict[str, Any]) -> str | None:
    """Extract the text to scan from task kwargs.

    Triage tasks receive an ``issue_data`` dict with ``title`` and ``body``.
    Agent dispatch tasks receive an ``issue_context`` dict.
    """
    issue_data = kwargs.get("issue_data") or {}
    if isinstance(issue_data, dict):
        title = issue_data.get("title", "")
        body = issue_data.get("body", "")
        description = issue_data.get("description", "")
        combined = f"{title}\n{body}\n{description}"
        if combined.strip():
            return combined

    issue_context = kwargs.get("issue_context") or {}
    if isinstance(issue_context, dict):
        title = issue_context.get("issue_title", "")
        body = issue_context.get("issue_body", "")
        description = issue_context.get("issue_description", "")
        combined = f"{title}\n{body}\n{description}"
        if combined.strip():
            return combined

    # Fallback: scan any string-valued kwargs
    text_parts: list[str] = []
    for val in kwargs.values():
        if isinstance(val, str) and len(val) > 20:
            text_parts.append(val)
    if text_parts:
        return "\n".join(text_parts)

    return None


def _get_issue_id(kwargs: dict[str, Any]) -> str:
    """Extract an issue identifier from task kwargs."""
    issue_data = kwargs.get("issue_data") or {}
    if isinstance(issue_data, dict):
        iid = issue_data.get("id") or issue_data.get("identifier") or ""
        if iid:
            return iid

    issue_context = kwargs.get("issue_context") or {}
    if isinstance(issue_context, dict):
        iid = issue_context.get("issue_id") or issue_context.get("identifier") or ""
        if iid:
            return iid

    return kwargs.get("issue_id") or kwargs.get("identifier") or "unknown"


# ---------------------------------------------------------------------------
# Signal handler
# ---------------------------------------------------------------------------


@signals.task_prerun.connect
def _check_injection_before_task(
    task_id: str,
    task: Any,
    args: tuple,
    kwargs: dict,
    **signal_kwargs: Any,
) -> None:
    """Celery prerun signal handler — scan issue text for injection.

    Connected automatically via the ``@signals.task_prerun.connect``
    decorator.  Just importing this module activates it.
    """
    task_name = getattr(task, "name", None)
    if not task_name:
        return

    if task_name not in _TARGET_TASKS:
        return

    config = _get_config()
    if config.mode.value == "off":
        return

    text = _extract_text(kwargs)
    if not text:
        return

    result = InjectionGuard.scan(text)

    if not result.detected:
        return

    issue_id = _get_issue_id(kwargs)
    severity_label = result.severity

    if config.mode.value == "strict":
        annotation = result.caution_annotation()

        if annotation:
            annotations = kwargs.setdefault("_guardrail_annotations", [])
            annotations.append(annotation)

        # Strict mode: block on critical/high severity
        if severity_label in ("critical", "high", "medium"):
            _post_injection_comment(issue_id, result, config)
            logger.warning(
                "Injection guard blocked task=%s issue=%s severity=%s score=%.2f patterns=%s",
                task_name,
                issue_id,
                severity_label,
                result.score,
                result.patterns_matched,
            )
            raise Ignore()

        # Medium/low in strict mode: just flag
        if config.guardrail_level >= 2 and annotation and not config.silent_annotate:
            _post_injection_comment(issue_id, result, config)
        else:
            logger.info(
                "Injection guard flagged (strict) task=%s issue=%s severity=%s score=%.2f",
                task_name,
                issue_id,
                severity_label,
                result.score,
            )

    elif config.mode.value == "moderate":
        annotation = result.caution_annotation()
        if annotation:
            annotations = kwargs.setdefault("_guardrail_annotations", [])
            annotations.append(annotation)

        if config.guardrail_level >= 2 and annotation and not config.silent_annotate:
            _post_injection_comment(issue_id, result, config)
        else:
            logger.info(
                "Injection guard flagged (moderate) task=%s issue=%s severity=%s score=%.2f patterns=%s",
                task_name,
                issue_id,
                severity_label,
                result.score,
                result.patterns_matched,
            )


# ---------------------------------------------------------------------------
# Connection acknowledgment
# ---------------------------------------------------------------------------


def connect_injection_middleware() -> None:
    """Acknowledge injection middleware connection (call at startup)."""
    config = _get_config()
    logger.info(
        "Injection middleware connected — mode=%s threshold=%.2f "
        "silent_annotate=%s guardrail_level=%d",
        config.mode.value,
        config.strict_threshold,
        config.silent_annotate,
        config.guardrail_level,
    )
