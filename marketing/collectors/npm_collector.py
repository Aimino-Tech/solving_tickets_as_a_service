"""npm collector — fetches package download statistics.

Uses npm API (public, no API key needed).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.request import Request, urlopen

from marketing.collectors.base import BaseCollector

logger = logging.getLogger(__name__)

_NPM_API = "https://api.npmjs.org/downloads/point"


class NPMCollector(BaseCollector):
    """Collects npm download metrics for tracked packages."""

    DEFAULT_PACKAGES: list[str] = [
        "@aimino/opentalk2html-notmd",
    ]

    def __init__(self, duckdb_store: Any) -> None:
        super().__init__(duckdb_store)
        self._packages = self._get_packages() or list(self.DEFAULT_PACKAGES)

    def _get_packages(self) -> list[str]:
        """Read npm packages from campaign config."""
        try:
            from marketing.store import CampaignStore

            store = CampaignStore()
            campaigns = store.list_campaigns()
            packages: set[str] = set()
            for c in campaigns:
                config = _safe_json(c.get("config_json"))
                if isinstance(config, dict):
                    pkg = config.get("npm_package", "")
                    if pkg:
                        packages.add(pkg)
            return list(packages)
        except Exception:
            return []

    def collect(
        self, since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Collect npm download data for tracked packages.

        Returns raw events for dashboard display.
        """
        events: list[dict[str, Any]] = []
        for pkg in self._packages:
            for period, label in [
                ("last-day", "downloads_last_day"),
                ("last-week", "downloads_last_week"),
                ("last-month", "downloads_last_month"),
            ]:
                url = f"{_NPM_API}/{period}/{pkg}"
                try:
                    req = Request(
                        url,
                        headers={"User-Agent": "Hermes-Marketing/1.0"},
                    )
                    with urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        downloads = data.get("downloads", 0)
                        events.append({
                            "platform": "npm",
                            "source_id": f"{pkg}:{period}",
                            "event_type": "download",
                            "content": (
                                f"npm package {pkg}: "
                                f"{downloads} downloads ({period})"
                            ),
                            "author": "npm",
                            "url": f"https://www.npmjs.com/package/{pkg}",
                            "score": downloads,
                            "metadata": {
                                "package": pkg,
                                "period": period,
                                "downloads": downloads,
                            },
                            "campaign_name": "",
                            "occurred_at": (
                                datetime.now(timezone.utc).isoformat()
                            ),
                        })
                except Exception as e:
                    logger.debug("npm %s %s: %s", pkg, period, e)

        return events


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
