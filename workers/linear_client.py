"""
Linear GraphQL API client for STAS worker processes.

Provides synchronous, lightweight access to the Linear API for
dependency resolution and issue queries in the Celery pipeline.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

LINEAR_API_URL = "https://api.linear.app/graphql"
LINEAR_API_KEY_ENV = "LINEAR_API_KEY"

# Terminal workflow states that indicate a blocker is resolved
TERMINAL_STATES = {"Done", "Verified", "Canceled"}

# Active (non-terminal) workflow states
ACTIVE_STATES = {"Todo", "In Progress", "In Review", "Backlog"}


class LinearClient:
    """
    Synchronous GraphQL client for the Linear API.

    Usage::

        client = LinearClient()
        blockers = client.get_blockers("issue-id-123")
        client.post_comment("issue-id-123", "Blocked by ...")
    """

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or os.getenv(LINEAR_API_KEY_ENV, "")
        if not self._api_key:
            logger.warning(
                "LINEAR_API_KEY not set - Linear API calls will fail"
            )

        self._http = httpx.Client(
            base_url=LINEAR_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": self._api_key,
            },
            timeout=httpx.Timeout(30.0),
        )

    # ------------------------------------------------------------------
    # Public API
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

    def post_comment(self, issue_id: str, body: str) -> bool:
        """
        Post a comment on a Linear issue.

        Returns ``True`` if the comment was created successfully.
        """
        mutation = """
        mutation CreateComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
                success
                comment { id }
            }
        }
        """
        try:
            data = self._request(
                mutation,
                {"input": {"issueId": issue_id, "body": body}},
            )
            success = (
                data.get("commentCreate", {}).get("success", False)
            )
            if not success:
                logger.warning(
                    "Failed to post comment on issue %s", issue_id
                )
            return success
        except Exception as exc:
            logger.warning(
                "Error posting comment on issue %s: %s",
                issue_id,
                exc,
            )
            return False

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
