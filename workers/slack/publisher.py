"""
Slack publisher — send progress updates and notifications back to Slack.

Provides a high-level API for sending pipeline status updates to Slack
channels or threads, using the Slack Web API with the bot token.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

logger = logging.getLogger(__name__)

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_SIGNING_SECRET = os.getenv("SLACK_SIGNING_SECRET", "")

_client: WebClient | None = None


def _get_client() -> WebClient | None:
    global _client
    if _client is None and SLACK_BOT_TOKEN:
        _client = WebClient(token=SLACK_BOT_TOKEN)
    return _client


def post_message(
    channel: str,
    text: str,
    thread_ts: str | None = None,
    blocks: list[dict] | None = None,
) -> dict[str, Any] | None:
    client = _get_client()
    if not client:
        logger.warning("SLACK_BOT_TOKEN not configured — skipping Slack message")
        return None
    try:
        resp = client.chat_postMessage(
            channel=channel,
            text=text,
            thread_ts=thread_ts,
            blocks=blocks,
        )
        return resp.data
    except SlackApiError as exc:
        logger.error("Slack API error: %s", exc)
        return None


def update_message(
    channel: str,
    ts: str,
    text: str,
    blocks: list[dict] | None = None,
) -> dict[str, Any] | None:
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.chat_update(
            channel=channel,
            ts=ts,
            text=text,
            blocks=blocks,
        )
        return resp.data
    except SlackApiError as exc:
        logger.error("Slack API error on update: %s", exc)
        return None


def post_ephemeral(
    channel: str,
    user: str,
    text: str,
    blocks: list[dict] | None = None,
) -> dict[str, Any] | None:
    client = _get_client()
    if not client:
        return None
    try:
        resp = client.chat_postEphemeral(
            channel=channel,
            user=user,
            text=text,
            blocks=blocks,
        )
        return resp.data
    except SlackApiError as exc:
        logger.error("Slack API error on ephemeral: %s", exc)
        return None


def send_pipeline_progress(
    channel: str,
    thread_ts: str,
    run_id: str,
    status: str,
    stage: str = "",
    progress: float = 0.0,
) -> None:
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Pipeline Update* — `{run_id}`",
            },
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Status:*\n{status}"},
                {"type": "mrkdwn", "text": f"*Stage:*\n{stage or '-'}"},
                {"type": "mrkdwn", "text": f"*Progress:*\n{int(progress * 100)}%"},
            ],
        },
    ]
    post_message(channel=channel, thread_ts=thread_ts, text=f"Pipeline update: {status}", blocks=blocks)


def send_fix_request_notification(
    channel: str,
    issue_title: str,
    issue_url: str,
    run_id: str,
) -> dict[str, Any] | None:
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "🛠️ STAS Fix Requested", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*<{issue_url}|{issue_title}>*"},
        },
        {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Run: `{run_id}`"}]},
    ]
    return post_message(channel=channel, text=f"STAS Fix: {issue_title}", blocks=blocks)


def send_pipeline_completed(
    channel: str,
    thread_ts: str,
    run_id: str,
    pr_url: str | None = None,
    status: str = "completed",
) -> None:
    emoji = "✅" if status == "completed" else "❌" if status == "failed" else "⚠️"
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{emoji} *Pipeline {status}* — `{run_id}`",
            },
        },
    ]
    if pr_url:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"🔗 <{pr_url}|View Pull Request>"},
        })
    post_message(channel=channel, thread_ts=thread_ts, text=f"Pipeline {status}: {run_id}", blocks=blocks)
