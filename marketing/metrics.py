"""Metrics collector — polls external APIs for campaign performance data.

Uses ``urllib.request`` and ``json`` from stdlib only.  Every collector
returns a dict with ``source``, ``value``, and ``error`` fields and
gracefully handles network failures (never raises).

GitHub API: ``https://api.github.com/repos/{repo}``
npm API: ``https://api.npmjs.org/downloads/point/{period}/{package}``
X/Twitter: stub only — X API requires OAuth authentication.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from marketing.store import CampaignStore

logger = logging.getLogger(__name__)

# ── API endpoint templates ─────────────────────────────────────────────────

_GITHUB_API_TMPL = "https://api.github.com/repos/{repo}"
_NPM_POINT_TMPL = "https://api.npmjs.org/downloads/point/{period}/{package}"

# ── Collector class ────────────────────────────────────────────────────────


class MetricsCollector:
    """Polls GitHub stars/forks, npm downloads, and (stub) X mentions.

    Usage::

        store = CampaignStore()
        collector = MetricsCollector(store)

        # Single source
        gh = collector.collect_github_metrics("owner/repo")
        npm = collector.collect_npm_metrics("@scope/pkg")

        # All-at-once (stores to DB, returns metric_id)
        metric_id = collector.collect_all(
            campaign_id="abc123",
            repo="owner/repo",
            package="@scope/pkg",
        )
    """

    def __init__(self, store: CampaignStore) -> None:
        self._store = store

    # ── internal helpers ──────────────────────────────────────────────────

    @staticmethod
    def _now() -> str:
        """Return current UTC timestamp as ISO-8601 string."""
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _json_get(url: str, timeout: int = 15) -> dict[str, Any] | None:
        """Fetch *url* and parse the JSON response.

        Uses stdlib ``urllib.request`` with a 15 s timeout.
        Returns ``None`` on any network or parse error (already logged).
        """
        import urllib.error
        import urllib.request

        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Hermes-MetricsCollector/1.0"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return dict(json.loads(resp.read().decode("utf-8")))
        except (urllib.error.URLError, urllib.error.HTTPError,
                OSError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("HTTP request failed for %s: %s", url, exc)
            return None

    # ── per-source collectors ─────────────────────────────────────────────

    def collect_github_metrics(self, repo: str) -> dict[str, Any]:
        """Query GitHub REST API for *repo* (``owner/name``).

        Returns::

            {
                "source": "github",
                "value": 42,             # stargazers_count
                "error": None,
                "detail": {
                    "stars": 42,
                    "forks": 7,
                    "watchers": 3,
                },
            }

        On failure *value* is ``0`` and *error* describes the problem.
        """
        url = _GITHUB_API_TMPL.format(repo=repo)
        data = self._json_get(url)
        if data is None:
            return {
                "source": "github",
                "value": 0,
                "error": f"Failed to fetch {url}",
            }

        try:
            stars = int(data.get("stargazers_count", 0))
            forks = int(data.get("forks_count", 0))
            watchers = int(data.get("subscribers_count", 0))
        except (ValueError, TypeError) as exc:
            return {
                "source": "github",
                "value": 0,
                "error": str(exc),
            }

        return {
            "source": "github",
            "value": stars,
            "error": None,
            "detail": {
                "stars": stars,
                "forks": forks,
                "watchers": watchers,
            },
        }

    def collect_npm_metrics(self, package: str) -> dict[str, Any]:
        """Query npm registry download counts for *package*.

        Collects last-day, last-week, and last-month download counts.

        Returns::

            {
                "source": "npm",
                "value": 15234,          # last-month downloads
                "error": None,
                "detail": {
                    "last_day": 512,
                    "last_week": 3891,
                    "last_month": 15234,
                },
            }

        On partial failure the missing periods default to ``0``.
        """
        periods = {
            "last_day": "last-day",
            "last_week": "last-week",
            "last_month": "last-month",
        }
        results: dict[str, int] = {}

        for key, period in periods.items():
            url = _NPM_POINT_TMPL.format(period=period, package=package)
            data = self._json_get(url)
            if data is not None:
                try:
                    results[key] = int(data.get("downloads", 0))
                except (ValueError, TypeError):
                    results[key] = 0
                    logger.warning("Invalid download count for %s (%s)", package, period)
            else:
                results[key] = 0

        return {
            "source": "npm",
            "value": results.get("last_month", 0),
            "error": None,
            "detail": results,
        }

    def collect_x_mentions(
        self, keywords: list[str] | None = None
    ) -> dict[str, Any]:
        """Stub — X/Twitter mentions collection.

        The X API requires OAuth 1.0a authentication which is not yet
        configured.  This method logs a warning and returns zero.

        Returns::

            {
                "source": "x",
                "value": 0,
                "error": "X API requires authentication — not implemented",
            }
        """
        logger.warning(
            "X mentions collection is a stub — X API requires auth. "
            "Keywords: %s",
            keywords or [],
        )
        return {
            "source": "x",
            "value": 0,
            "error": "X API requires authentication — not implemented",
        }

    # ── batch collect + persist ───────────────────────────────────────────

    def collect_all(
        self,
        campaign_id: str,
        repo: str | None = None,
        package: str | None = None,
    ) -> int:
        """Collect all available metrics for *campaign_id* and persist them.

        Args:
            campaign_id: Target campaign ID.
            repo: GitHub ``owner/name``.  When ``None``, GitHub metrics
                are skipped (logged, no error).
            package: npm package name.  When ``None``, npm metrics are
                skipped.

        Returns:
            The auto-generated metric ID from ``store.insert_metric()``.
        """
        github_stars = 0
        npm_downloads = 0

        if repo:
            gh = self.collect_github_metrics(repo)
            if gh.get("error") is None:
                github_stars = gh["value"]
                logger.info(
                    "GitHub %s: %d stars, %d forks, %d watchers",
                    repo,
                    gh.get("detail", {}).get("stars", 0),
                    gh.get("detail", {}).get("forks", 0),
                    gh.get("detail", {}).get("watchers", 0),
                )
            else:
                logger.warning("GitHub metrics for %s: %s", repo, gh["error"])

        if package:
            npm = self.collect_npm_metrics(package)
            if npm.get("error") is None:
                npm_downloads = npm["value"]
                detail = npm.get("detail", {})
                logger.info(
                    "npm %s: %d last-day, %d last-week, %d last-month",
                    package,
                    detail.get("last_day", 0),
                    detail.get("last_week", 0),
                    detail.get("last_month", 0),
                )
            else:
                logger.warning("npm metrics for %s: %s", package, npm["error"])

        # X mentions is always a stub — still record 0 so the metric row
        # has an explicit entry.
        x_val = self.collect_x_mentions()["value"]

        metric_id = self._store.insert_metric(
            campaign_id=campaign_id,
            github_stars=github_stars,
            npm_downloads=npm_downloads,
            x_mentions=x_val,
        )

        logger.info(
            "Stored metrics for campaign %s: github=%d, npm=%d, x=%d "
            "(metric_id=%d)",
            campaign_id,
            github_stars,
            npm_downloads,
            x_val,
            metric_id,
        )
        return metric_id
