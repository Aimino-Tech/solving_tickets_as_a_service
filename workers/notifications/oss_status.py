"""
OSS status comments — GitHub-issue-centric pipeline progress for self-hosted
deployments.

For OSS (self-hosted) users, pipeline status updates are posted as GitHub
issue comments instead of Linear comments.  This module mirrors the stage-
emoji config from ``status_comments`` but routes through GitHub's API and
tracks a repository identifier with each event.

Integration
-----------
The module can be used as a **drop-in supplement** to ``status_comments``.
Call ``post_oss_comment`` alongside ``post_stage_comment`` when the pipeline
knows it is operating in OSS mode (i.e. the request originated from a
self-hosted instance rather than the SYNTARO cloud).

Config
------
``SYNTARO_OSS_STATUS_ENABLED`` (env var, default ``"true"``):
    Set to ``"false"`` to disable OSS status comments globally.

``SYNTARO_OSS_STATUS_COALESCE_SECONDS`` (env var, default ``"3"``):
    Coalesce window for completed-stage events.

Stage identifiers and their emoji prefixes:

    =============  =====  =============
    Stage          Emoji  Label
    =============  =====  =============
    triage         📋     Triage
    research       🔍     Research
    agent          🤖     Agent
    verify         🧪     Verify
    self_audit     🔬     Self-Audit
    review         👁️     Review
    pr             🔄     PR
    failed         ❌     Failed
    =============  =====  =============
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Emoji / label maps  (mirrors workers.notifications.status_comments)
# ---------------------------------------------------------------------------

OSS_STAGE_EMOJI: dict[str, str] = {
    "triage": "\U0001f4cb",      # 📋
    "research": "\U0001f50d",    # 🔍
    "agent": "\U0001f916",       # 🤖
    "verify": "\U0001f9ea",      # 🧪
    "self_audit": "\U0001f52c",  # 🔬
    "review": "\U0001f441\ufe0f",  # 👁️
    "pr": "\U0001f504",          # 🔄
    "failed": "\u274c",          # ❌
}

OSS_STAGE_LABELS: dict[str, str] = {
    "triage": "Triage",
    "research": "Research",
    "agent": "Agent",
    "verify": "Verify",
    "self_audit": "Self-Audit",
    "review": "Review",
    "pr": "PR",
}

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OSS_STATUS_ENABLED = os.getenv(
    "SYNTARO_OSS_STATUS_ENABLED", "true",
).lower() in ("true", "1", "yes")

OSS_STATUS_COALESCE_SECONDS = float(
    os.getenv("SYNTARO_OSS_STATUS_COALESCE_SECONDS", "3"),
)

# ---------------------------------------------------------------------------
# Coalescer singleton
# ---------------------------------------------------------------------------

_oss_coalescer: Any | None = None  # OssStageCoalescer (lazy import)


def _get_oss_coalescer() -> "OssStageCoalescer":
    """Return the shared ``OssStageCoalescer`` singleton."""
    from workers.notifications.oss_coalescer import OssStageCoalescer

    global _oss_coalescer
    if _oss_coalescer is None:
        _oss_coalescer = OssStageCoalescer(
            window_seconds=OSS_STATUS_COALESCE_SECONDS,
            flush_callback=_flush_oss_events,
        )
    return _oss_coalescer


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_oss_message(
    stage: str,
    status: str,
    message: str,
) -> str:
    """Format a single OSS stage status update as a comment body."""
    emoji = OSS_STAGE_EMOJI.get(stage, "\u2022")  # bullet fallback
    label = OSS_STAGE_LABELS.get(stage, stage.title())
    return f"{emoji} **{label}**: {message}"


def _build_progressive_body(
    issue_id: str,
    stages: dict[str, dict[str, Any]],
) -> str:
    """Build a simple progressive-status comment body.

    Unlike the full HTML-collapsible comment built by ``progressive.py``,
    this produces a plain Markdown comment suitable for GitHub issues.
    """
    from workers.notifications.status_comments import STAGE_ORDER

    lines: list[str] = [
        f"## Pipeline Progress — {issue_id}",
        "",
    ]

    for stage_name in STAGE_ORDER:
        s = stages.get(stage_name)
        emoji = OSS_STAGE_EMOJI.get(stage_name, "\u2022")
        label = OSS_STAGE_LABELS.get(stage_name, stage_name.title())

        if s is None:
            lines.append(f"- ~~{emoji} {label}~~ &mdash; _pending_")
        elif s["status"] == "completed":
            lines.append(f"- ✅ {emoji} {label} — {s.get('message', '')}")
        elif s["status"] == "started":
            lines.append(f"- ⏳ {emoji} {label} — {s.get('message', '')}")
        elif s["status"] == "failed":
            lines.append(f"- ❌ {emoji} {label} — {s.get('message', '')}")
        else:
            lines.append(f"- {emoji} {label} — {s.get('message', '')}")

        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Flush callback (called by the coalescer's timer thread)
# ---------------------------------------------------------------------------

_oss_issue_states: dict[str, dict[str, dict[str, Any]]] = {}


def _flush_oss_events(events: list[dict[str, Any]]) -> None:
    """Rebuild and post the progressive OSS comment with coalesced events.

    Called from the ``OssStageCoalescer`` timer thread when the idle window
    expires.
    """
    if not events:
        return

    # Group events by (repo, issue_id) so each issue gets one update.
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for e in events:
        key = (e["repo"], e["issue_id"])
        groups.setdefault(key, []).append(e)

    for (repo, issue_id), group in groups.items():
        if issue_id not in _oss_issue_states:
            _oss_issue_states[issue_id] = {}
        for e in group:
            _oss_issue_states[issue_id][e["stage"]] = {
                "stage": e["stage"],
                "status": e["status"],
                "message": e["message"],
            }

        body = _build_progressive_body(issue_id, _oss_issue_states[issue_id])
        _post_to_github_issue(repo, issue_id, body)
        logger.info(
            "Updated OSS progressive comment repo=%s issue=%s (from %d coalesced event(s))",
            repo, issue_id, len(group),
        )


# ---------------------------------------------------------------------------
# GitHub issue comment posting
# ---------------------------------------------------------------------------

_github_comment_ids: dict[str, str] = {}


def _post_to_github_issue(repo: str, issue_number: str, body: str) -> None:
    """Post or update a GitHub issue comment for *repo* / *issue_number*.

    If a comment ID has already been recorded for this issue the existing
    comment is updated in place.  Otherwise a new comment is created and
    its ID is cached for future updates.

    Silently catches errors to avoid breaking the pipeline.
    """
    cache_key = f"{repo}#{issue_number}"
    try:
        # Lazy import to avoid hard dependency on GitHub SDK in workers
        from github import Github
        from github.GithubException import GithubException

        gh = Github(os.getenv("GITHUB_TOKEN", ""))
        gh_repo = gh.get_repo(repo)
        gh_issue = gh_repo.get_issue(int(issue_number))

        comment_id = _github_comment_ids.get(cache_key)
        if comment_id:
            comment = gh_repo.get_comment(int(comment_id))
            comment.edit(body)
            logger.debug(
                "Updated GitHub comment repo=%s issue=%s comment=%s",
                repo, issue_number, comment_id,
            )
        else:
            comment = gh_issue.create_comment(body)
            _github_comment_ids[cache_key] = str(comment.id)
            logger.info(
                "Created GitHub comment repo=%s issue=%s comment=%s",
                repo, issue_number, comment.id,
            )
    except ImportError:
        logger.warning(
            "PyGithub not installed — cannot post OSS comment to repo=%s issue=%s",
            repo, issue_number,
        )
    except GithubException as exc:
        logger.warning(
            "GitHub API error posting comment repo=%s issue=%s: %s",
            repo, issue_number, exc,
        )
    except Exception as exc:
        logger.warning(
            "Failed to post/update GitHub comment repo=%s issue=%s: %s",
            repo, issue_number, exc,
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_oss_state: dict[str, dict[str, dict[str, Any]]] = {}


def post_oss_comment(
    repo: str,
    issue_id: str,
    stage: str,
    status: str,
    message: str,
) -> dict[str, Any]:
    """Post a progressive OSS status comment for a pipeline stage transition.

    Uses a single evolving comment that shows the full pipeline state.
    Completed stages are coalesced (batched in a 3 s window).  Start and
    failure statuses are posted immediately.

    Parameters
    ----------
    repo:
        GitHub repository identifier (e.g. ``"owner/repo"``).
    issue_id:
        GitHub issue number as a string (e.g. ``"42"``).
    stage:
        Stage identifier (``"triage"``, ``"agent"``, ``"verify"``, etc.).
    status:
        One of ``"started"``, ``"completed"``, ``"failed"``.
    message:
        Human-readable status message.

    Returns
    -------
    A dict with keys ``status`` (``"posted"``, ``"coalesced"``,
    ``"disabled"``, or ``"error"``) and optional ``error`` message.
    """
    if not OSS_STATUS_ENABLED:
        logger.debug(
            "OSS status comments disabled — skipping stage=%s repo=%s issue=%s",
            stage, repo, issue_id,
        )
        return {"status": "disabled"}

    # Track state in the per-issue dict
    if issue_id not in _oss_state:
        _oss_state[issue_id] = {}
    _oss_state[issue_id][stage] = {
        "stage": stage,
        "status": status,
        "message": message,
    }

    if status == "completed":
        coalescer = _get_oss_coalescer()
        coalescer.add_event(repo, issue_id, stage, status, message)
        return {"status": "coalesced"}

    if status == "failed":
        message = _sanitize_oss_error(message)
        _oss_state[issue_id][stage]["message"] = message

    body = _build_progressive_body(issue_id, _oss_state[issue_id])
    try:
        _post_to_github_issue(repo, issue_id, body)
        logger.info(
            "Posted OSS %s comment repo=%s issue=%s stage=%s",
            status, repo, issue_id, stage,
        )
        return {"status": "posted"}
    except Exception as exc:
        logger.warning(
            "Failed to post OSS %s comment repo=%s issue=%s: %s",
            status, repo, issue_id, exc,
        )
        return {"status": "error", "error": str(exc)}


def _sanitize_oss_error(error: str, max_length: int = 500) -> str:
    """Truncate and sanitize an error message for public display."""
    if not error:
        return "Unknown error"
    sanitized = error.split("\n")[0].strip()
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."
    return sanitized


def set_oss_enabled(enabled: bool) -> None:
    """Enable or disable OSS status comments at runtime (test helper)."""
    global OSS_STATUS_ENABLED
    OSS_STATUS_ENABLED = enabled
