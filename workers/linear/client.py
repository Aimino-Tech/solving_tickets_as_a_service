"""
Linear GraphQL API client for STAS worker processes.

Provides cached, rate-limited access to the Linear API:
- ``get_issues_by_state(states)`` — fetch issues in the given workflow states
- ``transition_issue(issue_id, state_id)`` — move an issue to a new state
- ``post_comment(issue_id, body)`` — add a comment to an issue
- ``get_project_by_slug(slug)`` — fetch a project by its URL slug

Rate limiting (200 requests/minute per API key) is handled with an
in-memory token bucket.  If a 429 response is received, the client
applies exponential backoff (1s, 2s, 4s, … up to 60s).

Cached lookups (projects, teams, workflow states) are refreshed every 5
minutes to avoid repeated queries for the same identifiers.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

LINEAR_API_URL = "https://api.linear.app/graphql"
DEFAULT_RATE_LIMIT = 200          # requests / minute
CACHE_TTL_SECONDS = 300           # 5 minutes
MAX_BACKOFF_SECONDS = 60.0
INITIAL_BACKOFF_SECONDS = 1.0
BACKOFF_MULTIPLIER = 2.0

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class LinearIssue:
    """Represents a Linear issue returned from the GraphQL API."""
    id: str
    title: str
    description: str | None
    priority: float
    state_name: str
    state_type: str
    team_key: str
    labels: list[str]
    url: str
    created_at: str
    updated_at: str


@dataclass
class LinearProject:
    """Represents a Linear project."""
    id: str
    name: str
    slug: str
    description: str | None
    state: str
    teams: list[str]


# ---------------------------------------------------------------------------
# Token-bucket rate limiter
# ---------------------------------------------------------------------------

class TokenBucket:
    """Simple in-memory token-bucket rate limiter."""

    def __init__(self, capacity: int, refill_seconds: float = 60.0) -> None:
        self._capacity = capacity
        self._tokens = float(capacity)
        self._refill_rate = capacity / refill_seconds
        self._last_refill = time.monotonic()

    def acquire(self, tokens: float = 1.0) -> float:
        """Block until *tokens* are available, returning the wait time."""
        while True:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(
                self._capacity,
                self._tokens + elapsed * self._refill_rate,
            )
            self._last_refill = now

            if self._tokens >= tokens:
                self._tokens -= tokens
                return 0.0

            wait = (tokens - self._tokens) / self._refill_rate
            logger.debug("Rate limit reached — sleeping %.2f s", wait)
            time.sleep(wait)


# ---------------------------------------------------------------------------
# Cache entry
# ---------------------------------------------------------------------------

class _CacheEntry:
    """Thin wrapper that expires after *ttl* seconds."""

    __slots__ = ("value", "_expires_at")

    def __init__(self, value: object, ttl: float = CACHE_TTL_SECONDS) -> None:
        self.value = value
        self._expires_at = time.monotonic() + ttl

    @property
    def expired(self) -> bool:
        return time.monotonic() > self._expires_at


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class LinearClient:
    """
    GraphQL client for the Linear API.

    Usage::

        client = LinearClient(api_key="lin_api_...")
        issues = client.get_issues_by_state(["Todo", "In Progress"])
        client.transition_issue(issues[0].id, target_state_id)
        client.post_comment(issues[0].id, "Working on this …")
    """

    def __init__(
        self,
        api_key: str | None = None,
        rate_limit: int = DEFAULT_RATE_LIMIT,
    ) -> None:
        self._api_key = api_key or os.getenv("LINEAR_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "LINEAR_API_KEY must be provided or set in the environment",
            )

        self._http = httpx.AsyncClient(
            base_url=LINEAR_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            },
            timeout=httpx.Timeout(30.0),
        )
        self._bucket = TokenBucket(capacity=rate_limit)
        self._cache: dict[str, _CacheEntry] = {}

    # ── Public API ──────────────────────────────────────────────────────

    async def get_issues_by_state(
        self,
        states: list[str],
    ) -> list[LinearIssue]:
        """
        Fetch all issues whose workflow state name is in *states*.

        Results are paginated automatically (first 250 per page).
        """
        query = """
        query GetIssuesByState($filter: IssueFilter!, $after: String) {
          issues(filter: $filter, first: 250, after: $after) {
            nodes {
              id
              title
              description
              priority
              state { name type }
              team { key }
              labels { nodes { name } }
              url
              createdAt
              updatedAt
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        """

        variables: dict[str, Any] = {
            "filter": {
                "state": {"name": {"in": states}},
            },
        }
        return await self._paginate_issues(query, variables)

    async def transition_issue(
        self,
        issue_id: str,
        state_id: str,
    ) -> dict[str, Any]:
        """
        Transition *issue_id* to the workflow state identified by *state_id*.

        Returns the raw mutation response data.
        """
        mutation = """
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { id state { id name type } }
          }
        }
        """
        return await self._request(
            mutation,
            {"id": issue_id, "input": {"stateId": state_id}},
        )

    async def post_comment(
        self,
        issue_id: str,
        body: str,
    ) -> dict[str, Any]:
        """
        Add a comment to the given issue.

        Returns the raw mutation response data.
        """
        mutation = """
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment { id body }
          }
        }
        """
        return await self._request(
            mutation,
            {"input": {"issueId": issue_id, "body": body}},
        )

    async def get_project_by_slug(
        self,
        slug: str,
    ) -> LinearProject | None:
        """
        Look up a Linear project by its URL slug (e.g. ``"my-project"``).

        Results are cached per slug for *CACHE_TTL_SECONDS*.
        """
        cache_key = f"project_slug:{slug}"
        cached = self._cache.get(cache_key)
        if cached is not None and not cached.expired:
            return cached.value  # type: ignore[return-value]

        query = """
        query GetProjectBySlug($slug: String!) {
          project(slug: $slug) {
            id
            name
            slug
            description
            state
            teams { nodes { id key name } }
          }
        }
        """
        data = await self._request(query, {"slug": slug})
        proj = data.get("project")
        if proj is None:
            self._cache[cache_key] = _CacheEntry(None)
            return None

        project = LinearProject(
            id=proj["id"],
            name=proj["name"],
            slug=proj["slug"],
            description=proj.get("description"),
            state=proj.get("state", ""),
            teams=[t["key"] for t in proj.get("teams", {}).get("nodes", [])],
        )
        self._cache[cache_key] = _CacheEntry(project)
        return project

    # ── Helpers ─────────────────────────────────────────────────────────

    async def _request(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute a GraphQL request with rate limiting and 429 backoff."""
        self._bucket.acquire()
        backoff = INITIAL_BACKOFF_SECONDS

        for attempt in range(5):
            try:
                resp = await self._http.post(
                    LINEAR_API_URL,
                    json={"query": query, "variables": variables or {}},
                )
            except httpx.TimeoutException:
                logger.warning(
                    "Linear API timeout — retrying in %.1f s", backoff,
                )
                await _async_sleep(backoff)
                backoff = min(
                    backoff * BACKOFF_MULTIPLIER,
                    MAX_BACKOFF_SECONDS,
                )
                continue

            if resp.status_code == 429:
                logger.warning(
                    "Linear API rate limited (429) — backing off %.1f s",
                    backoff,
                )
                await _async_sleep(backoff)
                backoff = min(
                    backoff * BACKOFF_MULTIPLIER,
                    MAX_BACKOFF_SECONDS,
                )
                continue

            resp.raise_for_status()
            body: dict[str, Any] = resp.json()

            if "errors" in body and body["errors"]:
                messages = [e["message"] for e in body["errors"]]
                raise LinearAPIError(
                    f"GraphQL error(s): {'; '.join(messages)}",
                )

            return body.get("data", body)

        raise LinearAPIError("Max retries exceeded for Linear API request")

    async def _paginate_issues(
        self,
        query: str,
        variables: dict[str, Any],
    ) -> list[LinearIssue]:
        """Paginate over the ``issues`` connection."""
        all_issues: list[LinearIssue] = []
        after: str | None = None

        while True:
            if after:
                variables["after"] = after

            data = await self._request(query, variables)
            edges = data.get("issues", {})
            nodes = edges.get("nodes", [])
            page_info = edges.get("pageInfo", {})

            for node in nodes:
                all_issues.append(self._build_issue(node))

            if not page_info.get("hasNextPage"):
                break
            after = page_info.get("endCursor")

        return all_issues

    @staticmethod
    def _build_issue(node: dict[str, Any]) -> LinearIssue:
        state = node.get("state", {}) or {}
        team = node.get("team", {}) or {}
        labels = node.get("labels", {}).get("nodes", [])

        return LinearIssue(
            id=node["id"],
            title=node.get("title", ""),
            description=node.get("description"),
            priority=node.get("priority", 0.0),
            state_name=state.get("name", "Unknown"),
            state_type=state.get("type", "unstarted"),
            team_key=team.get("key", ""),
            labels=[lbl["name"] for lbl in labels],
            url=node.get("url", ""),
            created_at=node.get("createdAt", ""),
            updated_at=node.get("updatedAt", ""),
        )

    async def aclose(self) -> None:
        """Close the underlying HTTP client session."""
        await self._http.aclose()


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class LinearAPIError(Exception):
    """Raised when the Linear API returns an error or retries are exhausted."""


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

async def _async_sleep(seconds: float) -> None:
    """Async-compatible sleep."""
    try:
        import asyncio
        await asyncio.sleep(seconds)
    except RuntimeError:
        time.sleep(seconds)
