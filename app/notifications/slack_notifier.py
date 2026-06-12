"""
Slack notification service for campaign alerts.

Provides functions for sending campaign status updates, error alerts,
and daily summaries to Slack channels via the Slack WebClient (Bot Token).

Configuration (environment variables):
  SLACK_BOT_TOKEN              -- Bot token (xoxb-...) for API calls
  SLACK_NOTIFICATION_CHANNEL   -- Default channel to send notifications to
  SLACK_NOTIFICATIONS_ENABLED  -- Master toggle (true/false, default: false)

Usage:
    from app.notifications.slack_notifier import notify_campaign_status

    notify_campaign_status("Q4 Launch", "launched", {"day": 1})
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_enabled() -> bool:
    """Check whether Slack notifications are enabled via env var."""
    val = os.getenv("SLACK_NOTIFICATIONS_ENABLED", "").strip().lower()
    return val in ("true", "1", "yes", "on")


def _get_client() -> Optional[Any]:
    """Create a Slack WebClient from ``SLACK_BOT_TOKEN``.

    Returns ``None`` (with a logged warning) when the token is missing,
    so callers can fire-and-forget without checking first.
    """
    token = os.getenv("SLACK_BOT_TOKEN")
    if not token:
        logger.debug("SLACK_BOT_TOKEN not set -- skipping Slack notification")
        return None
    try:
        from slack_sdk import WebClient

        return WebClient(token=token)
    except ImportError:
        logger.warning(
            "slack_sdk is not installed -- cannot send Slack notification. "
            "Install with: pip install slack-sdk"
        )
        return None
    except Exception as exc:
        logger.warning("Failed to create Slack WebClient: %s", exc)
        return None


def _get_channel(override: Optional[str] = None) -> Optional[str]:
    """Return the target channel, falling back to the env-var default."""
    channel = override or os.getenv("SLACK_NOTIFICATION_CHANNEL")
    if not channel:
        logger.debug(
            "SLACK_NOTIFICATION_CHANNEL not set -- skipping Slack notification"
        )
        return None
    return channel


def _send_message(
    text: str,
    blocks: Optional[list[dict[str, Any]]] = None,
    channel: Optional[str] = None,
) -> bool:
    """Post a message (plain text + optional Block Kit) to a Slack channel.

    Args:
        text: Fallback plain-text message (shown in push notifications).
        blocks: Optional list of Block Kit blocks for rich formatting.
        channel: Target channel/chat ID; falls back to
            ``SLACK_NOTIFICATION_CHANNEL``.

    Returns:
        ``True`` when the message was accepted by the Slack API.
    """
    if not _is_enabled():
        logger.debug("Slack notifications disabled (SLACK_NOTIFICATIONS_ENABLED)")
        return False

    client = _get_client()
    target = _get_channel(channel)
    if not client or not target:
        return False

    try:
        kwargs: dict[str, Any] = {"channel": target, "text": text}
        if blocks:
            kwargs["blocks"] = blocks
        response = client.chat_postMessage(**kwargs)
        ok = bool(response.get("ok", False))
        if not ok:
            logger.warning(
                "Slack API returned not-ok: %s",
                response.get("error", "unknown"),
            )
        return ok
    except Exception as exc:
        logger.error("Failed to send Slack notification: %s", exc, exc_info=True)
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def notify_campaign_status(
    campaign_name: str,
    status: str,
    details: Optional[Dict[str, Any]] = None,
    channel: Optional[str] = None,
) -> bool:
    """Send a campaign status update to Slack.

    Produces a rich Block Kit message with a header, status line, and
    optional detail fields.

    Args:
        campaign_name: Display name of the campaign.
        status: Status label (e.g. ``"launched"``, ``"in_progress"``,
            ``"completed"``).
        details: Optional mapping of extra key/value pairs shown as
            Slack section fields.
        channel: Target channel override.

    Returns:
        ``True`` if the message was accepted by the Slack API.
    """
    text = f"\U0001f4e2 *Campaign Status*: *{campaign_name}* -- {status}"

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"\U0001f4e2 Campaign: {campaign_name}",
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Status:* {status}"},
        },
    ]

    if details:
        fields: list[dict[str, str]] = []
        for key, value in details.items():
            fields.append(
                {"type": "mrkdwn", "text": f"*{key}:* {value}"}
            )
        if fields:
            # Slack allows up to 10 fields per section
            for i in range(0, len(fields), 10):
                blocks.append({"type": "section", "fields": fields[i : i + 10]})

    blocks.append(
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "Campaign notification via Hermes Agent"}
            ],
        }
    )

    return _send_message(text, blocks=blocks, channel=channel)


def notify_error(
    campaign_name: str,
    error: str,
    channel: Optional[str] = None,
) -> bool:
    """Send an error alert for a campaign.

    Produces a prominent Block Kit message with a header and a
    code-formatted error block.

    Args:
        campaign_name: Display name of the campaign.
        error: Error description (rendered inside a code block).
        channel: Target channel override.

    Returns:
        ``True`` if the message was accepted by the Slack API.
    """
    text = f"\U0001f6a8 *Campaign Error*: *{campaign_name}*\n```{error}```"

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"\U0001f6a8 Campaign Error: {campaign_name}",
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Error:*\n```{error}```"},
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "Action may be required"}
            ],
        },
    ]

    return _send_message(text, blocks=blocks, channel=channel)


def notify_daily_summary(
    summary_data: Dict[str, Any],
    channel: Optional[str] = None,
) -> bool:
    """Send a daily campaign summary to Slack.

    The summary data dict is rendered as a header followed by field
    sections.  Keys control the field labels; values are shown as plain
    text.  A ``"date"`` key is extracted for the subtitle; all other
    entries become section fields.

    Args:
        summary_data: Mapping of metric names to values.
            Example: ``{"date": "2024-01-01", "posts": 5, "engagements": 42}``.
        channel: Target channel override.

    Returns:
        ``True`` if the message was accepted by the Slack API.
    """
    date_label = summary_data.get("date", "Unknown date")
    text = f"\U0001f4ca *Daily Campaign Summary* -- {date_label}"

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "\U0001f4ca Daily Campaign Summary",
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Date:* {date_label}"},
        },
    ]

    fields: list[dict[str, str]] = []
    for key, value in summary_data.items():
        if key == "date":
            continue
        fields.append({"type": "mrkdwn", "text": f"*{key}:* {value}"})
    if fields:
        for i in range(0, len(fields), 10):
            blocks.append({"type": "section", "fields": fields[i : i + 10]})

    blocks.append(
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "Daily summary via Hermes Agent"}
            ],
        }
    )

    return _send_message(text, blocks=blocks, channel=channel)
