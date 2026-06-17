"""GitHub collector — fetches traffic stats (clones, views, referrers).

Uses GitHub REST API (requires ``GH_PAT`` or ``GITHUB_TOKEN`` env var with
``repo:read`` scope).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from marketing.collectors.base import BaseCollector

logger = logging.getLogger(__name__)

_GITHUB_API = "https://api.github.com"


class GitHubCollector(BaseCollector):
    """Collects GitHub traffic metrics (clones, views, referrers)."""

    # Repos to track — read from campaign config or hardcoded defaults
    DEFAULT_REPOS: list[str] = [
        "Aimino-Tech/OpenTalk2HTML-NotMD",
        "Aimino-Tech/white-collar-agi",
    ]

    def __init__(self, duckdb_store: Any) -> None:
        super().__init__(duckdb_store)
        self._token = (
            os.environ.get("GH_PAT", "")
            or os.environ.get("GITHUB_TOKEN", "")
        )
        self._repos = self._get_repos()

    def _get_repos(self) -> list[str]:
        """Read repos from campaign config via CampaignStore."""
        try:
            from marketing.store import CampaignStore

            store = CampaignStore()
            campaigns = store.list_campaigns()
            repos: set[str] = set()
            for c in campaigns:
                config = _safe_json(c.get("config_json"))
                if isinstance(config, dict):
                    repo = config.get("github_repo", "")
                    if repo:
                        repos.add(repo)
            return list(repos) if repos else self.DEFAULT_REPOS
        except Exception:
            return list(self.DEFAULT_REPOS)

    def collect(
        self, since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Collect GitHub stars and issue counts.

        Returns raw events (stars, forks) for the dashboard.
        Traffic data (clones, views) is stored separately via
        :meth:`collect_traffic`.
        """
        events: list[dict[str, Any]] = []
        for repo in self._repos:
            try:
                data = self._fetch(f"/repos/{repo}")
                if data and "stargazers_count" in data:
                    events.append({
                        "platform": "github",
                        "source_id": f"{repo}:star",
                        "event_type": "star",
                        "content": (
                            f"Repo {repo} now has "
                            f"{data['stargazers_count']} stars"
                        ),
                        "author": "github",
                        "url": f"https://github.com/{repo}",
                        "score": data.get("stargazers_count", 0),
                        "metadata": {
                            "repo": repo,
                            "forks": data.get("forks_count", 0),
                            "open_issues": data.get("open_issues_count", 0),
                        },
                        "campaign_name": "",
                        "occurred_at": datetime.now(timezone.utc).isoformat(),
                    })
            except Exception as e:
                logger.warning("GitHub repo %s: %s", repo, e)
        return events

    def _fetch(self, path: str) -> dict[str, Any] | None:
        """Make a GitHub API request."""
        if not self._token:
            logger.warning("No GitHub token set — skipping API call")
            return None
        url = f"{_GITHUB_API}{path}"
        req = Request(
            url,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Hermes-Marketing/1.0",
            },
        )
        try:
            with urlopen(req, timeout=15) as resp:
                return dict(json.loads(resp.read().decode("utf-8")))
        except HTTPError as e:
            if e.code == 403:
                logger.warning("GitHub API rate limited on %s", path)
            elif e.code == 404:
                logger.debug("GitHub API 404 on %s", path)
            else:
                logger.warning(
                    "GitHub API error %s on %s: %s", e.code, path, e,
                )
        except Exception as e:
            logger.warning("GitHub API request failed: %s", e)
        return None

    def collect_traffic(self) -> int:
        """Collect GitHub Traffic API data (clones, views).

        Returns count of traffic records inserted.
        Requires GitHub token with ``repo:read`` scope.
        """
        traffic_count = 0
        for repo in self._repos:
            # Clones
            clones = self._fetch(f"/repos/{repo}/traffic/clones")
            views = self._fetch(f"/repos/{repo}/traffic/views")

            clones_unique = 0
            clones_count = 0
            views_unique = 0
            views_count = 0

            if clones and isinstance(clones, dict):
                clones_unique = clones.get("count", 0)
                clones_count = clones.get("uniques", 0)

            if views and isinstance(views, dict):
                views_unique = views.get("count", 0)
                views_count = views.get("uniques", 0)

            if clones or views:
                traffic_count += self.store.insert_github_traffic([{
                    "repo": repo,
                    "clones_unique": clones_unique,
                    "clones_count": clones_count,
                    "views_unique": views_unique,
                    "views_count": views_count,
                }])

        return traffic_count


def _safe_json(val: Any, default: Any = None) -> Any:
    """Parse JSON string safely."""
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            pass
    return default
