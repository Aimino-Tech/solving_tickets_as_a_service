"""
Discord webhook notifier.

Formats pipeline events as Discord embed messages and POSTs them to
a Discord Incoming Webhook URL. Supports rate-limit back-off with
``Retry-After`` header handling.
"""

from __future__ import annotations

import logging
import time
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


def _build_embed(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    pr_url = payload.get("pr_url", "")
    summary = payload.get("summary", "")
    timestamp = payload.get("timestamp", "")

    title_map: dict[str, str] = {
        "fix_completed": "Fix Completed",
        "review_needed": "Review Needed",
        "rework_required": "Rework Required",
        "merge_completed": "Merged",
        "pipeline_failed": "Pipeline Failed",
    }
    embed_title = title_map.get(event_type, event_type.replace("_", " ").title())

    description_parts: list[str] = []
    if issue_title:
        description_parts.append(f"**{issue_id}**: {issue_title}")
    else:
        description_parts.append(f"**{issue_id}**")

    if summary:
        description_parts.append(f"\n{summary}")

    embed: dict[str, Any] = {
        "title": f"{embed_title} — {issue_id}",
        "description": "\n".join(description_parts),
        "color": COLOR_MAP.get(event_type, 0x0078D4),
        "fields": [],
    }

    if issue_url:
        embed["fields"].append({
            "name": "Issue",
            "value": issue_url,
            "inline": True,
        })

    if pr_url:
        embed["fields"].append({
            "name": "Pull Request",
            "value": pr_url,
            "inline": True,
        })

    if timestamp:
        embed["fields"].append({
            "name": "Timestamp",
            "value": timestamp,
            "inline": False,
        })

    embed["footer"] = {"text": "STAS Notification System"}
    return embed


def _post_with_retry(
    client: httpx.Client,
    url: str,
    json_body: dict[str, Any],
    max_retries: int = 3,
) -> httpx.Response:
    for attempt in range(max_retries):
        resp = client.post(url, json=json_body)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "5"))
            logger.warning(
                "Discord rate limited — retrying after %ds (attempt %d/%d)",
                retry_after, attempt + 1, max_retries,
            )
            time.sleep(retry_after)
            continue
        resp.raise_for_status()
        return resp
    logger.error("Discord rate-limit retries exhausted (%d attempts)", max_retries)
    resp.raise_for_status()
    return resp


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
    embed = _build_embed(event_type, payload)

    message: dict[str, Any] = {
        "content": f"**STAS {event_type.replace('_', ' ').title()}**",
        "embeds": [embed],
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            _post_with_retry(client, webhook_url, message)
        logger.info(
            "Discord notification sent — event=%s issue=%s webhook=%.20s",
            event_type, payload.get("issue_id", "?"), webhook_url,
        )
        return {"status": "sent"}
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Discord webhook HTTP error %s — %s",
            exc.response.status_code, exc.response.text[:500],
        )
        return {"status": "error", "error": f"HTTP {exc.response.status_code}"}
    except httpx.RequestError as exc:
        logger.warning("Discord webhook request failed — %s", exc)
        return {"status": "error", "error": str(exc)}
