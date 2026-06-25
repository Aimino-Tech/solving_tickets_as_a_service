import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

LINEAR_API_URL = "https://api.linear.app/graphql"


class LinearClient:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("LINEAR_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "LINEAR_API_KEY is not set. "
                "Pass api_key= or set the LINEAR_API_KEY environment variable."
            )

    def _graphql(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
        }
        with httpx.Client() as client:
            resp = client.post(
                LINEAR_API_URL,
                headers=headers,
                json={"query": query, "variables": variables or {}},
            )
            resp.raise_for_status()
            data = resp.json()
            if "errors" in data:
                errors = data["errors"]
                logger.error("Linear API error: %s", errors)
                raise RuntimeError(f"Linear API error: {errors}")
            return data.get("data", {})

    def post_comment(self, issue_id: str, body: str) -> dict[str, Any]:
        mutation = """
        mutation CommentCreate($issueId: String!, $body: String!) {
            commentCreate(input: { issueId: $issueId, body: $body }) {
                success
                comment { id }
            }
        }
        """
        result = self._graphql(mutation, {"issueId": issue_id, "body": body})
        comment_data = result.get("commentCreate", {})
        comment = comment_data.get("comment", {})
        return {"id": comment.get("id", "")}

    def transition_issue(self, issue_id: str, state_name: str) -> bool:
        query_issue = """
        query IssueTeam($issueId: String!) {
            issue(id: $issueId) {
                team { id }
            }
        }
        """
        issue_data = self._graphql(query_issue, {"issueId": issue_id})
        team_id = issue_data.get("issue", {}).get("team", {}).get("id")
        if not team_id:
            logger.warning("Could not find team for issue %s", issue_id)
            return False

        query_states = """
        query TeamStates($teamId: String!) {
            team(id: $teamId) {
                states { nodes { id name } }
            }
        }
        """
        states_data = self._graphql(query_states, {"teamId": team_id})
        states = (
            states_data.get("team", {}).get("states", {}).get("nodes", [])
        )

        target = next(
            (s for s in states if s["name"].lower() == state_name.lower()),
            None,
        )
        if not target:
            logger.warning(
                "State '%s' not found in team %s. Available: %s",
                state_name,
                team_id,
                [s["name"] for s in states],
            )
            return False

        mutation = """
        mutation IssueUpdate($issueId: String!, $stateId: String!) {
            issueUpdate(id: $issueId, input: { stateId: $stateId }) {
                success
            }
        }
        """
        self._graphql(mutation, {"issueId": issue_id, "stateId": target["id"]})
        logger.info(
            "Transitioned issue %s to state '%s' (%s)",
            issue_id,
            state_name,
            target["id"],
        )
        return True
