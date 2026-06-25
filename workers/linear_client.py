<<<<<<< HEAD
"""
Linear GraphQL API client for STAS worker processes.

Provides synchronous, lightweight access to the Linear API for
dependency resolution, issue comments, transitions, and queries.

Usage::

    client = LinearClient()
    blockers = client.get_blockers("ISSUE-1")
    comment = client.post_comment("ISSUE-1", "Hello")
    client.transition_issue("ISSUE-1", "Done")
"""

from __future__ import annotations

=======
>>>>>>> origin/main
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

LINEAR_API_URL = "https://api.linear.app/graphql"
<<<<<<< HEAD
LINEAR_API_KEY_ENV = "LINEAR_API_KEY"

# Terminal workflow states that indicate a blocker is resolved
TERMINAL_STATES = {"Done", "Verified", "Canceled"}

# Active (non-terminal) workflow states
ACTIVE_STATES = {"Todo", "In Progress", "In Review", "Backlog"}


class LinearClient:
    """
    Synchronous GraphQL client for the Linear API.

    Parameters
    ----------
    api_key : str or None
        Linear API key.  Falls back to the ``LINEAR_API_KEY`` environment
        variable.  Raises ``ValueError`` if neither is set.
    """

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or os.getenv(LINEAR_API_KEY_ENV, "")
        if not self._api_key:
=======


class LinearClient:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("LINEAR_API_KEY", "")
        if not self.api_key:
>>>>>>> origin/main
            raise ValueError(
                "LINEAR_API_KEY is not set. "
                "Pass api_key= or set the LINEAR_API_KEY environment variable."
            )

<<<<<<< HEAD
        self._http = httpx.Client(
            base_url=LINEAR_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": self._api_key,
            },
            timeout=httpx.Timeout(30.0),
        )

    # ------------------------------------------------------------------
    # Public API - shared
    # ------------------------------------------------------------------

    def post_comment(self, issue_id: str, body: str) -> dict[str, Any]:
        """
        Post a comment on a Linear issue.

        Returns a dict with ``{"id": "<comment-id>"}`` on success, or an
        empty dict on error.  (Backward-compatible with the original API.)
        """
        mutation = """
        mutation CreateComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
=======
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
>>>>>>> origin/main
                success
                comment { id }
            }
        }
        """
<<<<<<< HEAD
        try:
            data = self._request(
                mutation,
                {"input": {"issueId": issue_id, "body": body}},
            )
            comment_data = data.get("commentCreate", {})
            comment = comment_data.get("comment", {})
            return {"id": comment.get("id", "")}
        except Exception as exc:
            logger.warning(
                "Error posting comment on issue %s: %s",
                issue_id,
                exc,
            )
            return {}

    def transition_issue(self, issue_id: str, state_name: str) -> bool:
        """Move *issue_id* to the workflow state named *state_name*."""
        # 1. Fetch the team for this issue
=======
        result = self._graphql(mutation, {"issueId": issue_id, "body": body})
        comment_data = result.get("commentCreate", {})
        comment = comment_data.get("comment", {})
        return {"id": comment.get("id", "")}

    def transition_issue(self, issue_id: str, state_name: str) -> bool:
>>>>>>> origin/main
        query_issue = """
        query IssueTeam($issueId: String!) {
            issue(id: $issueId) {
                team { id }
            }
        }
        """
<<<<<<< HEAD
        issue_data = self._request(query_issue, {"issueId": issue_id})
=======
        issue_data = self._graphql(query_issue, {"issueId": issue_id})
>>>>>>> origin/main
        team_id = issue_data.get("issue", {}).get("team", {}).get("id")
        if not team_id:
            logger.warning("Could not find team for issue %s", issue_id)
            return False

<<<<<<< HEAD
        # 2. Get available workflow states for the team
=======
>>>>>>> origin/main
        query_states = """
        query TeamStates($teamId: String!) {
            team(id: $teamId) {
                states { nodes { id name } }
            }
        }
        """
<<<<<<< HEAD
        states_data = self._request(query_states, {"teamId": team_id})
=======
        states_data = self._graphql(query_states, {"teamId": team_id})
>>>>>>> origin/main
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

<<<<<<< HEAD
        # 3. Transition
=======
>>>>>>> origin/main
        mutation = """
        mutation IssueUpdate($issueId: String!, $stateId: String!) {
            issueUpdate(id: $issueId, input: { stateId: $stateId }) {
                success
            }
        }
        """
<<<<<<< HEAD
        self._request(mutation, {"issueId": issue_id, "stateId": target["id"]})
=======
        self._graphql(mutation, {"issueId": issue_id, "stateId": target["id"]})
>>>>>>> origin/main
        logger.info(
            "Transitioned issue %s to state '%s' (%s)",
            issue_id,
            state_name,
            target["id"],
        )
        return True
<<<<<<< HEAD

    # ------------------------------------------------------------------
    # Public API - dependency resolution
    # ------------------------------------------------------------------

    def get_blockers(self, issue_id: str) -> list[dict[str, Any]]:
        """
        Query Linear for all issues blocking the given issue.

        Returns a list of dicts with keys: ``id``, ``title``, ``status``.
        Returns an empty list if the issue has no blockers or is not found.
        """
        query = """
        query IssueBlockers($issueId: String!) {
            issue(id: $issueId) {
                id
                title
                children {
                    nodes {
                        id
                        title
                        state {
                            name
                        }
                    }
                }
            }
        }
        """
        data = self._request(query, {"issueId": issue_id})
        issue = data.get("issue")
        if not issue:
            logger.warning("Issue %s not found in Linear", issue_id)
            return []

        nodes = issue.get("children", {}).get("nodes", [])
        blockers = []
        for node in nodes:
            blockers.append({
                "id": node["id"],
                "title": node.get("title", ""),
                "status": node.get("state", {}).get("name", "Unknown"),
            })

        logger.debug(
            "Found %d blockers for issue %s",
            len(blockers),
            issue_id,
        )
        return blockers

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._http.close()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _request(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute a synchronous GraphQL request."""
        try:
            resp = self._http.post(
                LINEAR_API_URL,
                json={"query": query, "variables": variables or {}},
            )
            resp.raise_for_status()
            body: dict[str, Any] = resp.json()

            if "errors" in body and body["errors"]:
                messages = [e["message"] for e in body["errors"]]
                raise LinearAPIError(
                    f"GraphQL error(s): {'; '.join(messages)}"
                )

            return body.get("data", body)

        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Linear API HTTP error: %s - %s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            raise LinearAPIError(
                f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
            ) from exc
        except httpx.TimeoutException as exc:
            logger.warning("Linear API request timed out")
            raise LinearAPIError("Request timed out") from exc
        except httpx.RequestError as exc:
            logger.warning("Linear API request failed: %s", exc)
            raise LinearAPIError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class LinearAPIError(Exception):
    """Raised when the Linear API returns an error or is unreachable."""
=======
>>>>>>> origin/main
