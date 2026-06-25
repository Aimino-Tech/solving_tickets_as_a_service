"""
Microsoft Teams webhook notifier.

Formats pipeline events as Teams Adaptive Cards and POSTs them to
a Teams Incoming Webhook URL (connector card format).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Adaptive Card / Connector Card builders
# ---------------------------------------------------------------------------


def _build_teams_card(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Build a Teams connector card (Actionable Message) for the event.

    Teams incoming webhooks accept the legacy ``MessageCard`` format
    which is well-supported and simpler than Adaptive Cards for
    webhook connectors.
    """
    issue_id = payload.get("issue_id", "?")
    issue_title = payload.get("issue_title", "")
    issue_url = payload.get("issue_url", "")
    pr_url = payload.get("pr_url", "")
    summary = payload.get("summary", "")
    timestamp = payload.get("timestamp", "")

    color_map: dict[str, str] = {
        "fix_completed": "00A859",     # green
        "review_needed": "FFC107",     # amber
        "rework_required": "FF6B35",   # orange
        "merge_completed": "005A9E",   # blue
        "pipeline_failed": "E81123",   # red
    }
    color = color_map.get(event_type, "0078D4")

    title_map: dict[str, str] = {
        "fix_completed": "✅ Fix Completed",
        "review_needed": "👀 Review Needed",
        "rework_required": "🔁 Rework Required",
        "merge_completed": "🚀 Merged",
        "pipeline_failed": "❌ Pipeline Failed",
    }
    card_title = title_map.get(event_type, event_type)

    sections: list[dict[str, Any]] = [
        {
            "activityTitle": f"**{card_title} — {issue_id}**",
            "activitySubtitle": issue_title,
            "facts": [
                {"name": "Issue", "value": f"[{issue_id}]({issue_url})" if issue_url else issue_id},
            ],
            "markdown": True,
        }
    ]

    if pr_url:
        sections[0]["facts"].append({
            "name": "Pull Request",
            "value": f"[View PR]({pr_url})",
        })

    if summary:
        sections[0]["text"] = summary

    if timestamp:
        sections[0]["facts"].append({
            "name": "Timestamp",
            "value": timestamp,
        })

    potential_action = {
        "@type": "OpenUri",
        "name": "View Issue",
        "targets": [{"os": "default", "uri": issue_url}],
    } if issue_url else None

    card: dict[str, Any] = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "themeColor": color,
        "title": card_title,
        "sections": sections,
    }

    if potential_action:
        card["potentialAction"] = [potential_action]

    return card


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def notify_teams(
    payload: dict[str, Any],
    webhook_url: str,
) -> dict[str, Any]:
    """Send a Teams notification for a pipeline event.

    Parameters
    ----------
    payload:
        Normalised event payload (see ``webhooks.py``).
    webhook_url:
        Teams Incoming Webhook URL.

    Returns
    -------
    Dict with keys ``status`` (``sent`` / ``error``) and optional ``error``.
    """
    event_type = payload.get("event_type", "fix_completed")
    card = _build_teams_card(event_type, payload)

    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(webhook_url, json=card)
            resp.raise_for_status()

        logger.info(
            "Teams notification sent — event=%s issue=%s webhook=%.20s",
            event_type, payload.get("issue_id", "?"), webhook_url,
        )
        return {"status": "sent"}

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Teams webhook HTTP error %s — %s",
            exc.response.status_code, exc.response.text[:500],
        )
        return {"status": "error", "error": f"HTTP {exc.response.status_code}"}
    except httpx.RequestError as exc:
        logger.warning("Teams webhook request failed — %s", exc)
        return {"status": "error", "error": str(exc)}
