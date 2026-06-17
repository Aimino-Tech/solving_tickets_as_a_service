"""Reddit collector — fetches posts and comments from tracked campaigns.

Uses PRAW (Python Reddit API Wrapper) for live Reddit data.
Falls back to PullPush API (public, no auth) for historical data.

Requires env vars: ``REDDIT_CLIENT_ID``, ``REDDIT_CLIENT_SECRET``,
``REDDIT_USER_AGENT`` (optional, defaults to ``"Hermes-Marketing/1.0"``).
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.request import Request, urlopen

from marketing.collectors.base import BaseCollector

logger = logging.getLogger(__name__)


class RedditCollector(BaseCollector):
    """Collects Reddit engagement from campaign-related subreddits and posts."""

    # Subreddits to search for campaign mentions
    TARGET_SUBREDDITS: list[str] = [
        "MCP",
        "selfhosted",
        "SaaS",
        "artificial",
        "artificialintelligence",
        "opensource",
        "devops",
        "linux",
        "Python",
        "webdev",
        "SideProject",
        "SmallBiz",
        "Entrepreneur",
    ]

    # Campaign keywords to search
    CAMPAIGN_KEYWORDS: list[str] = [
        "OpenTalk2HTML",
        "Talk2HTML",
        "opentalk2html",
        "OpenDocswork",
        "Aimino",
        "aimino",
        "MCP server",
        "open source MCP",
    ]

    def __init__(self, duckdb_store: Any) -> None:
        super().__init__(duckdb_store)
        self._praw_available = False
        self._reddit: Any = None
        self._init_praw()

    def _init_praw(self) -> None:
        """Try to initialize PRAW (optional — falls back to PullPush)."""
        client_id = os.environ.get("REDDIT_CLIENT_ID")
        client_secret = os.environ.get("REDDIT_CLIENT_SECRET")
        user_agent = os.environ.get(
            "REDDIT_USER_AGENT", "Hermes-Marketing/1.0",
        )
        if client_id and client_secret:
            try:
                import praw  # type: ignore[import-untyped]

                self._reddit = praw.Reddit(
                    client_id=client_id,
                    client_secret=client_secret,
                    user_agent=user_agent,
                )
                self._praw_available = True
                logger.info("PRAW initialized for Reddit collection")
            except Exception as e:
                logger.warning(
                    "PRAW init failed: %s. Falling back to PullPush API.", e,
                )

    def collect(
        self, since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Collect Reddit posts and comments.

        Attempts PRAW first for live data, then PullPush for historical.
        """
        events: list[dict[str, Any]] = []
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(days=7)

        # Try PRAW for live data
        if self._praw_available:
            try:
                events.extend(self._collect_praw(since))
            except Exception as e:
                logger.warning("PRAW collection failed: %s", e)

        # Supplement with PullPush for historical coverage
        try:
            events.extend(self._collect_pullpush(since))
        except Exception as e:
            logger.warning("PullPush collection failed: %s", e)

        return events

    def _collect_praw(self, since: datetime) -> list[dict[str, Any]]:
        """Collect via PRAW (live Reddit API)."""
        events: list[dict[str, Any]] = []

        for subreddit_name in self.TARGET_SUBREDDITS:
            try:
                subreddit = self._reddit.subreddit(subreddit_name)  # type: ignore[union-attr]
                for submission in subreddit.search(
                    " OR ".join(self.CAMPAIGN_KEYWORDS),
                    sort="new",
                    time_filter="month",
                    limit=25,
                ):
                    created = datetime.fromtimestamp(
                        submission.created_utc, tz=timezone.utc,
                    )
                    if created < since:
                        continue
                    events.append({
                        "platform": "reddit",
                        "source_id": f"t3_{submission.id}",
                        "event_type": "post",
                        "content": submission.title[:500],
                        "author": (
                            str(submission.author)
                            if submission.author
                            else "[deleted]"
                        ),
                        "url": f"https://reddit.com{submission.permalink}",
                        "score": submission.score or 0,
                        "metadata": {
                            "subreddit": subreddit_name,
                            "num_comments": submission.num_comments,
                        },
                        "campaign_name": self._match_campaign(submission.title),
                        "occurred_at": created.isoformat(),
                    })

                    # Also collect comments from this post
                    try:
                        submission.comments.replace_more(limit=0)
                        for comment in submission.comments.list()[:20]:
                            if not hasattr(comment, "body") or not comment.body:
                                continue
                            comment_created = datetime.fromtimestamp(
                                comment.created_utc, tz=timezone.utc,
                            )
                            if comment_created < since:
                                continue
                            events.append({
                                "platform": "reddit",
                                "source_id": f"t1_{comment.id}",
                                "event_type": "comment",
                                "content": comment.body[:500],
                                "author": (
                                    str(comment.author)
                                    if comment.author
                                    else "[deleted]"
                                ),
                                "url": (
                                    f"https://reddit.com"
                                    f"{submission.permalink}{comment.id}"
                                ),
                                "score": comment.score or 0,
                                "metadata": {
                                    "subreddit": subreddit_name,
                                    "parent_id": submission.id,
                                },
                                "campaign_name": self._match_campaign(
                                    comment.body,
                                ),
                                "occurred_at": comment_created.isoformat(),
                            })
                    except Exception:
                        pass
            except Exception as e:
                logger.debug("PRAW subreddit %s: %s", subreddit_name, e)

        return events

    def _collect_pullpush(self, since: datetime) -> list[dict[str, Any]]:
        """Collect via PullPush API (public, no auth)."""
        events: list[dict[str, Any]] = []
        since_ts = int(since.timestamp())

        for keyword in self.CAMPAIGN_KEYWORDS:
            url = (
                "https://api.pullpush.io/reddit/search/submission/"
                f"?q={keyword}&size=25&sort=desc&sort_type=created_utc"
                f"&after={since_ts}"
            )
            try:
                req = Request(
                    url, headers={"User-Agent": "Hermes-Marketing/1.0"},
                )
                with urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    for post in data.get("data", []):
                        created = datetime.fromtimestamp(
                            post.get("created_utc", 0), tz=timezone.utc,
                        )
                        events.append({
                            "platform": "reddit",
                            "source_id": f"t3_{post['id']}",
                            "event_type": "post",
                            "content": (post.get("title", "") or "")[:500],
                            "author": post.get("author", "[deleted]"),
                            "url": (
                                "https://reddit.com/r/"
                                f"{post.get('subreddit', '')}/comments/"
                                f"{post['id']}/"
                            ),
                            "score": post.get("score", 0),
                            "metadata": {
                                "subreddit": post.get("subreddit", ""),
                                "source": "pullpush",
                            },
                            "campaign_name": self._match_campaign(
                                post.get("title", ""),
                            ),
                            "occurred_at": created.isoformat(),
                        })
            except Exception as e:
                logger.debug("PullPush keyword %s: %s", keyword, e)

        return events

    @staticmethod
    def _match_campaign(text: str | None) -> str:
        """Try to match text to a known campaign."""
        if not text:
            return ""
        text_lower = text.lower()
        if "opentalk2html" in text_lower or "talk2html" in text_lower:
            return "OpenTalk2HTML"
        if "opendocswork" in text_lower or "docswork" in text_lower:
            return "OpenDocswork"
        if "aimino" in text_lower:
            return "Aimino"
        return ""
