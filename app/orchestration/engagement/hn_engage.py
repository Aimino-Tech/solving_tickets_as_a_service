"""Hacker News engagement adapter.

Read: Firebase API (no auth) + Algolia search (no auth)
Write: Cookie-based posting via fnid token extraction
"""

import os
import re
import html
import logging
from urllib.parse import urljoin

import httpx

logger = logging.getLogger(__name__)

FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0"
ALGOLIA_BASE = "https://hn.algolia.com/api/v1"
HN_BASE = "https://news.ycombinator.com"

KEYWORDS = [
    "mcp", "model context protocol", "open source", "open source tool", "devtools",
    "data pipeline", "etl", "web scraper", "api integration",
    "data quality", "data migration", "data collection",
]


def keywords_match(text):
    text_lower = text.lower()
    for kw in KEYWORDS:
        if kw in text_lower:
            return True
    return False


class HNEngager:
    def __init__(self):
        self.client = httpx.Client(timeout=30.0)
        self._session_cookie = None

    def search_algolia(self, query="MCP open source", tags="story", limit=20):
        params = {
            "query": query,
            "tags": tags,
            "hitsPerPage": limit,
        }
        resp = self.client.get(f"{ALGOLIA_BASE}/search", params=params)
        resp.raise_for_status()
        data = resp.json()
        results = []
        for hit in data.get("hits", []):
            title = hit.get("title", "")
            url = hit.get("url") or f"{HN_BASE}/item?id={hit.get('objectID')}"
            results.append({
                "objectID": hit.get("objectID"),
                "title": title,
                "url": url,
                "author": hit.get("author"),
                "points": hit.get("points", 0),
                "num_comments": hit.get("num_comments", 0),
                "created_at": hit.get("created_at"),
                "matched": keywords_match(f"{title} {hit.get('story_text', '')}"),
            })
        return results

    def get_story(self, story_id):
        resp = self.client.get(f"{FIREBASE_BASE}/item/{story_id}.json")
        resp.raise_for_status()
        return resp.json()

    def get_top_stories(self, limit=20):
        resp = self.client.get(f"{FIREBASE_BASE}/topstories.json")
        resp.raise_for_status()
        story_ids = resp.json()[:limit]
        stories = []
        for sid in story_ids:
            story = self.get_story(sid)
            if story:
                stories.append({
                    "id": story.get("id"),
                    "title": story.get("title", ""),
                    "url": story.get("url"),
                    "author": story.get("by"),
                    "score": story.get("score", 0),
                    "descendants": story.get("descendants", 0),
                    "time": story.get("time"),
                    "matched": keywords_match(story.get("title", "")),
                })
        return stories

    def _extract_fnid(self, html_text):
        match = re.search(r'<input[^>]*name="fnid"[^>]*value="([^"]+)"', html_text)
        if match:
            return match.group(1)
        return None

    def get_login_page(self):
        resp = self.client.get(f"{HN_BASE}/login")
        resp.raise_for_status()
        return resp.text, dict(resp.cookies)

    def login(self):
        hn_user = os.getenv("HN_USERNAME")
        hn_pass = os.getenv("HN_PASSWORD")
        if not hn_user or not hn_pass:
            logger.warning("HN_USERNAME/HN_PASSWORD not set, skipping login")
            return False

        login_html, login_cookies = self.get_login_page()
        fnid = self._extract_fnid(login_html)
        if not fnid:
            logger.error("Could not extract fnid from login page")
            return False

        resp = self.client.post(
            f"{HN_BASE}/login",
            data={"fnid": fnid, "pwd": hn_pass, "goto": "news"},
            cookies=login_cookies,
            follow_redirects=True,
        )
        resp.raise_for_status()

        cookie_val = resp.cookies.get("user")
        if cookie_val:
            self._session_cookie = cookie_val
            logger.info("HN login successful")
            return True

        for c in resp.cookies:
            if "user" in c.name:
                self._session_cookie = c.value
                logger.info("HN login successful")
                return True

        logger.warning("HN login may have failed — no user cookie in response")
        return False

    def reply_to_story(self, story_id, comment_text):
        if not self._session_cookie:
            if not self.login():
                raise RuntimeError("Cannot post: HN login failed")

        # Get the story page to extract FNID for commenting
        item_url = f"{HN_BASE}/item?id={story_id}"
        resp = self.client.get(item_url)
        resp.raise_for_status()

        fnid = self._extract_fnid(resp.text)
        if not fnid:
            raise RuntimeError(f"Could not extract fnid from story {story_id}")

        resp = self.client.post(
            f"{HN_BASE}/comment",
            data={
                "fnid": fnid,
                "text": comment_text,
                "parent": story_id,
            },
            cookies={"user": self._session_cookie},
            follow_redirects=True,
        )
        resp.raise_for_status()

        # HN redirects to the story page after commenting, so we can't
        # reliably extract the new comment ID from the redirect URL.
        logger.info("Replied to HN story %s", story_id)
        return None

    def verify_auth(self):
        resp = self.client.get(f"{HN_BASE}/news", follow_redirects=True)
        resp.raise_for_status()
        logged_in = resp.url.path != "/login"
        return {
            "logged_in": logged_in,
            "cookie_set": self._session_cookie is not None,
        }
