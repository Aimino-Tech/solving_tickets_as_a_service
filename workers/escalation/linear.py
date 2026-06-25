from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

LINEAR_INCIDENT_TEAM_ID_ENV = "LINEAR_INCIDENT_TEAM_ID"
LINEAR_INCIDENT_LABEL_ID_ENV = "LINEAR_INCIDENT_LABEL_ID"


class LinearIncidentCreator:
    def __init__(self) -> None:
        self._team_id = os.getenv(LINEAR_INCIDENT_TEAM_ID_ENV, "")
        self._label_id = os.getenv(LINEAR_INCIDENT_LABEL_ID_ENV, "")

    def is_configured(self) -> bool:
        return bool(self._team_id)

    def create_incident(
        self,
        service: str,
        error: str,
        severity: str = "critical",
        context: dict[str, Any] | None = None,
    ) -> str:
        from workers.linear_client import LinearClient, LinearAPIError

        try:
            client = LinearClient()
        except ValueError as exc:
            logger.warning("Linear not configured — skipping incident creation: %s", exc)
            return ""

        title = f"[STAS Incident] {service} — {severity}"
        description = (
            f"## Auto-created Incident\n\n"
            f"**Service:** {service}\n"
            f"**Severity:** {severity}\n"
            f"**Error:** {error}\n"
            f"**Timestamp:** {datetime.now(timezone.utc).isoformat()}\n\n"
        )
        if context:
            description += f"**Context:**\n```json\n{context}```\n\n"
        description += (
            "**Action Required:** An operator must investigate and resolve this issue.\n"
            "This incident was automatically created by the STAS escalation system."
        )

        mutation = """
        mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
                success
                issue {
                    id
                    identifier
                }
            }
        }
        """
        variables: dict[str, Any] = {
            "input": {
                "teamId": self._team_id,
                "title": title,
                "description": description,
                "priority": 1,
            }
        }
        if self._label_id:
            variables["input"]["labelIds"] = [self._label_id]

        try:
            from workers.linear_client import LINEAR_API_URL

            import httpx
            api_key = os.getenv("LINEAR_API_KEY", "")
            resp = httpx.post(
                LINEAR_API_URL,
                json={"query": mutation, "variables": variables},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": api_key,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            issue = data.get("data", {}).get("issueCreate", {}).get("issue", {})
            identifier = issue.get("identifier", "")
            if identifier:
                logger.info("Created Linear incident %s for %s failure", identifier, service)
            return identifier
        except Exception as exc:
            logger.error("Failed to create Linear incident: %s", exc)
            return ""
