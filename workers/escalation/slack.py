from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL_ENV = "SLACK_WEBHOOK_URL"
SLACK_CHANNEL_ENV = "SLACK_ESCALATION_CHANNEL"
DEFAULT_CHANNEL = "#stas-oncall"


class SlackEscalator:
    def __init__(self) -> None:
        self._webhook_url = os.getenv(SLACK_WEBHOOK_URL_ENV, "")
        self._channel = os.getenv(SLACK_CHANNEL_ENV, DEFAULT_CHANNEL)

    def is_configured(self) -> bool:
        return bool(self._webhook_url)

    def page_oncall(
        self,
        issue_key: str,
        reason: str,
        retry_count: int,
        repo: str = "",
        issue_number: int = 0,
        trace: str = "",
    ) -> bool:
        if not self._webhook_url:
            logger.warning("Slack webhook not configured — skipping on-call page")
            return False

        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"🚨 *STAS Escalation — Manual Intervention Required*",
                },
            },
            {"type": "divider"},
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Issue:* {issue_key}"},
                    {"type": "mrkdwn", "text": f"*Reason:* {reason}"},
                    {"type": "mrkdwn", "text": f"*Retries:* {retry_count}"},
                    {"type": "mrkdwn", "text": f"*Repo:* {repo}#{issue_number}"},
                ],
            },
        ]
        if trace:
            blocks.append({
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"```{trace[:500]}```"},
                ],
            })
        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Acknowledge"},
                    "style": "primary",
                    "value": f"ack_{issue_key}",
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "View Issue"},
                    "url": f"https://linear.app/aimino/issue/{issue_key}",
                },
            ],
        })

        payload = {
            "text": f"[STAS Escalation] {issue_key}: {reason}",
            "channel": self._channel,
            "blocks": blocks,
        }

        try:
            resp = httpx.post(
                self._webhook_url,
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            logger.info("Slack escalation sent for %s — reason=%s", issue_key, reason)
            return True
        except Exception as exc:
            logger.error("Slack escalation failed for %s: %s", issue_key, exc)
            return False

    def alert_infrastructure_failure(
        self,
        service: str,
        error: str,
        context: dict[str, Any] | None = None,
    ) -> bool:
        if not self._webhook_url:
            return False

        text = (
            f"🚨 *STAS Infrastructure Failure*\n"
            f"*Service:* {service}\n"
            f"*Error:* {error}\n"
        )
        if context:
            text += f"*Context:* ```{json.dumps(context, indent=2)[:500]}```"

        payload = {"text": text, "channel": self._channel}
        try:
            resp = httpx.post(self._webhook_url, json=payload, timeout=15)
            resp.raise_for_status()
            return True
        except Exception as exc:
            logger.error("Infra alert failed: %s", exc)
            return False
