"""Hacker News collector — fetches mentions via Algolia API.

Uses Algolia HN Search API (public, no API key needed).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.request import Request, urlopen

from marketing.collectors.base import BaseCollector

logger = logging.getLogger(__name__)

_ALGOLIA_HN = "https://hn.algolia.com/api/v1"


class HNCollector(BaseCollector):
    """Collects Hacker News mentions of campaign products."""

    SEARCH_QUERIES: list[str] = [
        "OpenTalk2HTML",
        "Talk2HTML",
        "Aimino",
        "OpenDocswork",
    ]

    def collect(
        self, since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Search HN for campaign mentions."""
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(days=30)

        events: list[dict[str, Any]] = []
        since_ts = int(since.timestamp())

        for query in self.SEARCH_QUERIES:
            url = (
                f"{_ALGOLIA_HN}/search_by_date"
                f"?query={query}"
                f"&tags=story"
                f"&numericFilters=created_at_i>={since_ts}"
                f"&hitsPerPage=20"
            )
            try:
                req = Request(
                    url, headers={"User-Agent": "Hermes-Marketing/1.0"},
                )
                with urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    for hit in data.get("hits", []):
                        created_at = datetime.fromtimestamp(
                            hit.get("created_at_i", 0), tz=timezone.utc,
                        )
                        events.append({
                            "platform": "hackernews",
                            "source_id": str(hit.get("objectID", "")),
                            "event_type": "post",
                            "content": (
                                (hit.get("title", "") or "")[:500]
                            ),
                            "author": hit.get("author", "anonymous"),
                            "url": (
                                hit.get("url")
                                or (
                                    "https://news.ycombinator.com/"
                                    f"item?id={hit.get('objectID', '')}"
                                )
                            ),
                            "score": hit.get("points", 0),
                            "metadata": {
                                "num_comments": hit.get("num_comments", 0),
                                "query": query,
                                "source": "algolia",
                            },
                            "campaign_name": "",
                            "occurred_at": created_at.isoformat(),
                        })

                        # Also get comments for this story
                        comments = self._fetch_comments(
                            hit.get("objectID", ""),
                        )
                        events.extend(comments)
            except Exception as e:
                logger.debug("HN search '%s': %s", query, e)

        return events

    def _fetch_comments(self, story_id: str) -> list[dict[str, Any]]:
        """Fetch comments for an HN story."""
        events: list[dict[str, Any]] = []
        if not story_id:
            return events
        url = f"{_ALGOLIA_HN}/items/{story_id}"
        try:
            req = Request(
                url, headers={"User-Agent": "Hermes-Marketing/1.0"},
            )
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for child in data.get("children", []):
                    if child.get("type") != "comment" or not child.get("text"):
                        continue
                    created_at = datetime.fromtimestamp(
                        child.get("created_at_i", 0), tz=timezone.utc,
                    )
                    events.append({
                        "platform": "hackernews",
                        "source_id": f"c{child.get('id', '')}",
                        "event_type": "comment",
                        "content": (child.get("text", "") or "")[:500],
                        "author": child.get("author", "anonymous"),
                        "url": (
                            "https://news.ycombinator.com/"
                            f"item?id={story_id}"
                        ),
                        "score": child.get("points", 0),
                        "metadata": {
                            "parent_id": story_id,
                            "source": "algolia",
                        },
                        "campaign_name": "",
                        "occurred_at": created_at.isoformat(),
                    })
        except Exception as e:
            logger.debug("HN comments %s: %s", story_id, e)
        return events
