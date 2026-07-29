"""
Slack webhook notifier.

Formats pipeline events as Slack Block Kit messages and POSTs them to
a Slack Incoming Webhook URL. Supports rate-limit back-off with
``Retry-After`` header handling.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Block Kit message builders
# ---------------------------------------------------------------------------


def _build_fix_completed_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build Slack Block Kit blocks for a completed fix."""
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    pr_url = payload.get("pr_url", "")
    summary = payload.get("summary", "")

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"✅ Fix Completed — {issue_id}",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*<{issue_url}|{issue_id}: {issue_title}>*",
            },
        },
    ]

    if pr_url:
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"🔗 Pull Request: <{pr_url}|View PR>",
                },
            }
        )

    if summary:
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Summary:*\n{summary}",
                },
            }
        )

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {payload.get('timestamp', '')}",
                }
            ],
        }
    )

    return blocks


def _build_review_needed_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build Slack Block Kit blocks when a review is needed."""
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    pr_url = payload.get("pr_url", "")

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"👀 Review Needed — {issue_id}",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*<{issue_url}|{issue_id}: {issue_title}>*",
            },
        },
    ]

    if pr_url:
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"🔗 <{pr_url}|Review Pull Request>",
                },
            }
        )

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {payload.get('timestamp', '')}",
                }
            ],
        }
    )

    return blocks


def _build_rework_required_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build Slack Block Kit blocks when rework is required."""
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    summary = payload.get("summary", "")

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🔁 Rework Required — {issue_id}",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*<{issue_url}|{issue_id}: {issue_title}>*",
            },
        },
    ]

    if summary:
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Details:*\n{summary}",
                },
            }
        )

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {payload.get('timestamp', '')}",
                }
            ],
        }
    )

    return blocks


def _build_merge_completed_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build Slack Block Kit blocks when a PR is merged."""
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    pr_url = payload.get("pr_url", "")

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🚀 Merged — {issue_id}",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*<{issue_url}|{issue_id}: {issue_title}>* has been merged.",
            },
        },
    ]

    if pr_url:
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"🔗 <{pr_url}|View Pull Request>",
                },
            }
        )

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {payload.get('timestamp', '')}",
                }
            ],
        }
    )

    return blocks


def _build_pipeline_failed_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build Slack Block Kit blocks when the pipeline fails."""
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    summary = payload.get("summary", "")

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"❌ Pipeline Failed — {issue_id}",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*<{issue_url}|{issue_id}: {issue_title}>*",
            },
        },
    ]

    if summary:
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Error:*\n{summary}",
                },
            }
        )

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {payload.get('timestamp', '')}",
                }
            ],
        }
    )

    return blocks


# ---------------------------------------------------------------------------
# Block builder registry
# ---------------------------------------------------------------------------

_BLOCK_BUILDERS: dict[str, Any] = {
    "fix_completed": _build_fix_completed_blocks,
    "review_needed": _build_review_needed_blocks,
    "rework_required": _build_rework_required_blocks,
    "merge_completed": _build_merge_completed_blocks,
    "pipeline_failed": _build_pipeline_failed_blocks,
}


def _build_blocks(event_type: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return Slack Block Kit blocks for the given event type."""
    builder = _BLOCK_BUILDERS.get(event_type)
    if builder is None:
        # Fallback to a simple text message
        return [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{payload.get('event_type', 'event')}* — {payload.get('summary', '')}",
                },
            },
        ]
    return builder(payload)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _post_with_retry(
    client: httpx.Client,
    url: str,
    json_body: dict[str, Any],
    max_retries: int = 3,
) -> httpx.Response:
    """POST JSON to a Slack webhook URL, handling rate limits.

    If a ``429 Too Many Requests`` response is received with a
    ``Retry-After`` header, waits and retries up to ``max_retries`` times.
    """
    for attempt in range(max_retries):
        resp = client.post(url, json=json_body)

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "5"))
            logger.warning(
                "Slack rate limited — retrying after %ds (attempt %d/%d)",
                retry_after, attempt + 1, max_retries,
            )
            time.sleep(retry_after)
            continue

        resp.raise_for_status()
        return resp

    logger.error("Slack rate-limit retries exhausted (%d attempts)", max_retries)
    resp.raise_for_status()
    return resp  # unreachable, but satisfies type


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def notify_slack(
    payload: dict[str, Any],
    webhook_url: str,
    channel: str = "",
) -> dict[str, Any]:
    """Send a Slack notification for a pipeline event.

    Parameters
    ----------
    payload:
        Normalised event payload (see ``webhooks.py``).
    webhook_url:
        Slack Incoming Webhook URL.
    channel:
        Optional Slack channel override (e.g. ``#stas-alerts``).

    Returns
    -------
    Dict with keys ``status`` (``sent`` / ``error``) and optional ``error``.
    """
    event_type = payload.get("event_type", "fix_completed")
    blocks = _build_blocks(event_type, payload)

    message: dict[str, Any] = {
        "text": f"[STAS] {event_type} — {payload.get('issue_id', '?')}",
        "blocks": blocks,
    }
    if channel:
        message["channel"] = channel

    try:
        with httpx.Client(timeout=30.0) as client:
            _post_with_retry(client, webhook_url, message)
        logger.info(
            "Slack notification sent — event=%s issue=%s webhook=%.20s",
            event_type, payload.get("issue_id", "?"), webhook_url,
        )
        return {"status": "sent"}

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Slack webhook HTTP error %s — %s",
            exc.response.status_code, exc.response.text[:500],
        )
        return {"status": "error", "error": f"HTTP {exc.response.status_code}"}
    except httpx.RequestError as exc:
        logger.warning("Slack webhook request failed — %s", exc)
        return {"status": "error", "error": str(exc)}


def notify_slack_threaded(
    payload: dict[str, Any],
    channel: str,
    thread_ts: str | None = None,
) -> dict[str, Any]:
    """Send a bidirectional Slack notification using the bot token.

    Uses the Slack Web API (bot token) instead of a webhook URL,
    enabling threaded replies and interactive message components.

    Parameters
    ----------
    payload:
        Normalised event payload.
    channel:
        Slack channel ID (e.g. ``C0123456789``).
    thread_ts:
        Optional thread timestamp for threaded replies.

    Returns
    -------
    Dict with keys ``status`` (``sent`` / ``error``).
    """
    from workers.slack.publisher import get_client

    client = get_client()
    if not client:
        return {"status": "error", "error": "SLACK_BOT_TOKEN not configured"}

    event_type = payload.get("event_type", "fix_completed")
    blocks = _build_blocks(event_type, payload)
    text = f"[STAS] {event_type} — {payload.get('issue_id', '?')}"

    try:
        resp = client.chat_postMessage(
            channel=channel,
            text=text,
            blocks=blocks,
            thread_ts=thread_ts,
        )
        logger.info(
            "Slack threaded notification sent — event=%s channel=%s ts=%s",
            event_type, channel, resp.get("ts", "?"),
        )
        return {"status": "sent", "ts": resp.get("ts", "")}
    except Exception as exc:
        logger.error("Slack threaded notification failed: %s", exc)
        return {"status": "error", "error": str(exc)}


def notify_slack_progress(
    channel: str,
    thread_ts: str,
    run_id: str,
    status: str,
    stage: str = "",
    progress: float = 0.0,
    pr_url: str | None = None,
) -> dict[str, Any]:
    """Send a progress update to a Slack thread.

    Updates the original fix request thread with pipeline progress.

    Parameters
    ----------
    channel:
        Slack channel ID.
    thread_ts:
        Thread timestamp from the original fix request message.
    run_id:
        STAS pipeline run ID.
    status:
        Pipeline status (queued, in_progress, completed, failed, cancelled).
    stage:
        Current pipeline stage.
    progress:
        Progress percentage (0.0 - 1.0).
    pr_url:
        Pull request URL (for completed status).

    Returns
    -------
    Dict with keys ``status`` (``sent`` / ``error``).
    """
    from workers.slack.publisher import get_client

    client = get_client()
    if not client:
        return {"status": "error", "error": "SLACK_BOT_TOKEN not configured"}

    emoji = {
        "queued": "⏳", "in_progress": "🔄", "completed": "✅",
        "failed": "❌", "cancelled": "🚫",
    }.get(status, "ℹ️")

    blocks = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"{emoji} *Pipeline {status}* — `{run_id}`"},
        },
    ]
    if stage:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"Stage: *{stage}*  ·  Progress: {int(progress * 100)}%"}],
        })
    if pr_url:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"🔗 <{pr_url}|Pull Request Created>"},
        })

    if status in ("completed", "failed", "cancelled"):
        blocks.append({
            "type": "actions",
            "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "🔄 Retry"}, "value": run_id, "action_id": "retry_fix"},
            ],
        })

    try:
        resp = client.chat_postMessage(
            channel=channel,
            text=f"Pipeline {status}: {run_id}",
            thread_ts=thread_ts,
            blocks=blocks,
        )
        return {"status": "sent", "ts": resp.get("ts", "")}
    except Exception as exc:
        logger.error("Slack progress notification failed: %s", exc)
        return {"status": "error", "error": str(exc)}
