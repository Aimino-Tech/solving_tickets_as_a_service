"""
Slack event and command handlers for STAS.

Handles:
  - /stas fix <description> — Submit a fix request
  - app_mention — Process @STAS mentions
  - message.im — Process DMs to the bot
  - button interactions (acknowledge, cancel, retry)
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

from workers.slack.publisher import (
    post_ephemeral,
    post_message,
    send_fix_request_notification,
    send_pipeline_completed,
    send_pipeline_progress,
)

logger = logging.getLogger(__name__)

_STAS_LABEL = os.getenv("STAS_LABEL", "stas:fix")


def handle_slash_stas_fix(
    user_id: str,
    user_name: str,
    channel_id: str,
    text: str,
    trigger_id: str | None = None,
) -> dict[str, Any]:
    if not text or not text.strip():
        return {
            "response_type": "ephemeral",
            "text": "Please provide a description of what to fix.\n"
                    "Example: `/stas fix The login page crashes when entering special characters`",
        }

    post_ephemeral(
        channel=channel_id,
        user=user_id,
        text="🤖 *STAS* received your fix request and is investigating...",
    )

    return {
        "response_type": "in_channel",
        "text": f"🛠️ *STAS Fix Requested* by {user_name}\n> _{text}_",
    }


def handle_submit_fix_request(
    channel_id: str,
    issue_title: str,
    issue_body: str,
    repo_owner: str = "",
    repo_name: str = "",
) -> str:
    from workers.pipeline_client import get_client

    issue_url = f"https://github.com/{repo_owner}/{repo_name}/issues/new"
    pipeline = get_client()
    result = pipeline.submit_fix(
        owner=repo_owner or "unknown",
        repo=f"{repo_owner}/{repo_name}" if repo_owner else "unknown/unknown",
        issue_number=0,
        issue_url=issue_url,
    )
    run_id = result.get("run_id", "")
    notification = send_fix_request_notification(channel_id, issue_title, issue_url, run_id)
    if notification and notification.get("ts"):
        thread_ts = notification["ts"]
        send_pipeline_progress(channel_id, thread_ts, run_id, "queued", "Initializing", 0.0)
    return run_id


def handle_acknowledge(issue_id: str, channel: str, thread_ts: str) -> None:
    from workers.pipeline_client import get_client

    pipeline = get_client()
    result = pipeline.submit_fix(owner="", repo="", issue_number=0, issue_url=issue_id)
    run_id = result.get("run_id", "")
    send_pipeline_progress(channel, thread_ts, run_id, "accepted", "Starting pipeline", 0.1)


def handle_cancel(run_id: str, channel: str, thread_ts: str) -> None:
    from workers.pipeline_client import get_client

    pipeline = get_client()
    pipeline.cancel_fix(run_id)
    send_pipeline_completed(channel, thread_ts, run_id, status="cancelled")


def handle_retry(run_id: str, channel: str, thread_ts: str) -> None:
    from workers.pipeline_client import get_client

    pipeline = get_client()
    pipeline.submit_fix(owner="", repo="", issue_number=0, issue_url=f"retry:{run_id}")
    send_pipeline_progress(channel, thread_ts, run_id, "retrying", "Restarting pipeline", 0.0)


def parse_fix_command(text: str) -> dict[str, str]:
    text = text.strip()
    repo_match = re.match(r"(?:in|for)\s+([\w.-]+/[\w.-]+)\s*(?::\s*)?(.+)", text, re.IGNORECASE)
    if repo_match:
        return {"repo": repo_match.group(1), "description": repo_match.group(2)}
    url_match = re.match(r"(https?://github\.com/[\w.-]+/[\w.-]+(?:/issues/\d+)?)\s*(.*)", text, re.IGNORECASE)
    if url_match:
        return {"url": url_match.group(1), "description": url_match.group(2).strip()}
    return {"description": text}
