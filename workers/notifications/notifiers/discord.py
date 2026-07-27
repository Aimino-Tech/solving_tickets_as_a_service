"""
Discord webhook notifier.

Formats pipeline events as Discord embed messages and POSTs them to
a Discord Incoming Webhook URL.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

COLOR_MAP: dict[str, int] = {
    "fix_completed": 0x00A859,
    "review_needed": 0xFFC107,
    "rework_required": 0xFF6B35,
    "merge_completed": 0x005A9E,
    "pipeline_failed": 0xE81123,
}

EMOJI_MAP: dict[str, str] = {
    "fix_completed": "\u2705",
    "review_needed": "\U0001F440",
    "rework_required": "\U0001F501",
    "merge_completed": "\U0001F680",
    "pipeline_failed": "\u274C",
}

def _build_discord_embed(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    pr_url = payload.get("pr_url", "")
    summary = payload.get("summary", "")
    timestamp = payload.get("timestamp", "")

    color = COLOR_MAP.get(event_type, 0x0078D4)
    emoji = EMOJI_MAP.get(event_type, "")

    description = issue_title
    if summary:
        description = f"{issue_title}\n\n{summary}"

    embed: dict[str, Any] = {
        "title": f"{emoji} {event_type.replace('_', ' ').title()} \u2014 {issue_id}",
        "description": description,
        "color": color,
    }

    if issue_url:
        embed["url"] = issue_url

    fields: list[dict[str, Any]] = []
    if pr_url:
        fields.append({
            "name": "Pull Request",
            "value": pr_url,
            "inline": True,
        })
    if timestamp:
        embed["timestamp"] = timestamp

    if fields:
        embed["fields"] = fields

    return embed


def notify_discord(
    payload: dict[str, Any],
    webhook_url: str,
) -> dict[str, Any]:
    """Send a Discord notification for a pipeline event.

    Parameters
    ----------
    payload:
        Normalised event payload (see ``webhooks.py``).
    webhook_url:
        Discord Incoming Webhook URL.

    Returns
    -------
    Dict with keys ``status`` (``sent`` / ``error``) and optional ``error``.
    """
    event_type = payload.get("event_type", "fix_completed")
    embed = _build_discord_embed(event_type, payload)

    message: dict[str, Any] = {
        "content": f"**STAS** \u2014 {event_type.replace('_', ' ').title()}",
        "embeds": [embed],
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(webhook_url, json=message)
            resp.raise_for_status()

        logger.info(
            "Discord notification sent \u2014 event=%s issue=%s webhook=%.20s",
            event_type, payload.get("issue_id", "?"), webhook_url,
        )
        return {"status": "sent"}

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Discord webhook HTTP error %s \u2014 %s",
            exc.response.status_code, exc.response.text[:500],
        )
        return {"status": "error", "error": f"HTTP {exc.response.status_code}"}
    except httpx.RequestError as exc:
        logger.warning("Discord webhook request failed \u2014 %s", exc)
        return {"status": "error", "error": str(exc)}
