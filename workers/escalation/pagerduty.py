from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

PD_ROUTING_KEY_ENV = "PAGERDUTY_ROUTING_KEY"
OPSGENIE_API_KEY_ENV = "OPSGENIE_API_KEY"


class PagerDutyEscalator:
    def __init__(self) -> None:
        self._pd_key = os.getenv(PD_ROUTING_KEY_ENV, "")
        self._opsgenie_key = os.getenv(OPSGENIE_API_KEY_ENV, "")

    def is_configured(self) -> bool:
        return bool(self._pd_key) or bool(self._opsgenie_key)

    def fire_alert(
        self,
        issue_key: str,
        reason: str,
        retry_count: int,
        repo: str = "",
        issue_number: int = 0,
        trace: str = "",
    ) -> bool:
        dedup_key = f"stas:escalation:{issue_key}"

        if self._pd_key:
            return self._fire_pagerduty(dedup_key, issue_key, reason, retry_count, repo, issue_number, trace)
        elif self._opsgenie_key:
            return self._fire_opsgenie(dedup_key, issue_key, reason, retry_count, repo, issue_number, trace)
        else:
            logger.warning("No PagerDuty/Opsgenie key configured — skipping PD alert")
            return False

    def _fire_pagerduty(
        self,
        dedup_key: str,
        issue_key: str,
        reason: str,
        retry_count: int,
        repo: str,
        issue_number: int,
        trace: str,
    ) -> bool:
        payload = {
            "routing_key": self._pd_key,
            "event_action": "trigger",
            "dedup_key": dedup_key,
            "payload": {
                "summary": f"STAS max retries exceeded for {issue_key}: {reason}",
                "source": "stas-worker",
                "severity": "critical",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "component": "stas-agent-pipeline",
                "group": "stas-escalation",
                "class": "max_retries_exceeded",
                "custom_details": {
                    "issue_key": issue_key,
                    "reason": reason,
                    "retry_count": retry_count,
                    "repo": repo,
                    "issue_number": issue_number,
                    "trace": trace[:1000],
                },
            },
        }
        try:
            resp = httpx.post(
                "https://events.pagerduty.com/v2/enqueue",
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            logger.info("PagerDuty alert fired for %s", issue_key)
            return True
        except Exception as exc:
            logger.error("PagerDuty alert failed for %s: %s", issue_key, exc)
            return False

    def _fire_opsgenie(
        self,
        dedup_key: str,
        issue_key: str,
        reason: str,
        retry_count: int,
        repo: str,
        issue_number: int,
        trace: str,
    ) -> bool:
        payload = {
            "message": f"STAS max retries exceeded for {issue_key}",
            "alias": dedup_key,
            "description": f"Reason: {reason}\nRetries: {retry_count}\nRepo: {repo}#{issue_number}",
            "source": "stas-worker",
            "priority": "P1",
            "details": {
                "issue_key": issue_key,
                "reason": reason,
                "retry_count": str(retry_count),
                "repo": repo,
                "issue_number": str(issue_number),
            },
        }
        try:
            resp = httpx.post(
                "https://api.opsgenie.com/v2/alerts",
                json=payload,
                headers={"Authorization": f"GenieKey {self._opsgenie_key}"},
                timeout=15,
            )
            resp.raise_for_status()
            logger.info("Opsgenie alert fired for %s", issue_key)
            return True
        except Exception as exc:
            logger.error("Opsgenie alert failed for %s: %s", issue_key, exc)
            return False
