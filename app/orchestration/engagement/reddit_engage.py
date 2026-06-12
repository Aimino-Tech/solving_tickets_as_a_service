"""Reddit engagement adapter using PRAW with rate-limit resilience.

All PRAW API calls are wrapped with exponential backoff + jitter to handle
HTTP 429 (rate limited) and HTTP 403 (IP banned) gracefully.

Provides:
    - search_subreddits()
    - search_by_keywords()
    - reply_to_submission()
    - reply_to_comment()
    - verify_auth()
    - RedditEngager class
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import praw

from app.platforms.reddit_ratelimit import (
    call_with_backoff,
    is_rate_limit_error,
    reddit_proxy_pool,
    reddit_rate_limiter,
    reddit_ban_alert,
    rotate_user_agent,
)

logger = logging.getLogger(__name__)

KEYWORDS = [
    "mcp", "model context protocol", "open source tool", "devtools",
    "data pipeline", "etl", "web scraper", "api integration",
    "data quality", "data migration", "data collection",
]

# ---------------------------------------------------------------------------
# Reddit client factory with user-agent rotation & proxy support
# ---------------------------------------------------------------------------


def _get_reddit(user_agent: Optional[str] = None):
    """Create a PRAW Reddit instance with rotated user-agent and optional proxy."""
    ua = user_agent or rotate_user_agent()
    logger.debug("Creating PRAW instance with UA: %s ...", ua[:60])

    proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None
    if proxy_url:
        logger.info("Using proxy: %s", proxy_url[:40])

    return praw.Reddit(
        client_id=os.getenv("REDDIT_CLIENT_ID"),
        client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
        password=os.getenv("REDDIT_PASSWORD"),
        user_agent=ua,
        username=os.getenv("REDDIT_USERNAME"),
        requestor_kwargs={"proxy": proxy_url} if proxy_url else {},
    )


# ---------------------------------------------------------------------------
# Generic PRAW call wrapper with backoff
# ---------------------------------------------------------------------------


def _call_with_backoff(fn, *args, operation_id: str = "default", **kwargs):
    """Execute a PRAW callable with exponential backoff + jitter.

    Wraps ``call_with_backoff`` with additional logging of block events.
    """
    try:
        return call_with_backoff(
            fn,
            *args,
            limiter=reddit_rate_limiter,
            operation_id=operation_id,
            **kwargs,
        )
    except Exception as exc:
        error_msg = str(exc)
        status_code = (
            getattr(exc, "status_code", 0)
            or getattr(getattr(exc, "response", None), "status_code", 0)
        )
        if status_code in (429, 403) or is_rate_limit_error(exc):
            state_info = reddit_rate_limiter.state_snapshot.get(operation_id, {})
            logger.error(
                "REDDIT BLOCK EVENT [op=%s, status=%d, attempts=%d]: %s",
                operation_id,
                status_code,
                state_info.get("attempt", "?"),
                error_msg[:300],
            )
            reddit_ban_alert.fire(
                f"Reddit API block on {operation_id} (status={status_code})",
                operation=operation_id,
                status_code=status_code,
                error=error_msg[:300],
            )
        raise


# ---------------------------------------------------------------------------
# Keyword matching
# ---------------------------------------------------------------------------


def keywords_match(text: str) -> bool:
    """Check if *text* contains any of the engagement keywords."""
    text_lower = text.lower()
    for kw in KEYWORDS:
        if kw in text_lower:
            return True
    return False


# ---------------------------------------------------------------------------
# API functions
# ---------------------------------------------------------------------------


def search_subreddits(subreddits: str = "MCP+opensource+devtools", limit: int = 25) -> list[dict]:
    """Search multiple subreddits for hot posts and check keyword relevance."""
    reddit = _get_reddit()
    subreddit = reddit.subreddit(subreddits)

    posts = _call_with_backoff(
        subreddit.hot, limit=limit,
        operation_id=f"search_subreddits_{subreddits[:20]}",
    )

    results = []
    for submission in posts:
        text = f"{submission.title} {submission.selftext}"
        results.append({
            "id": submission.id,
            "title": submission.title,
            "text": submission.selftext[:500] if submission.selftext else "",
            "url": f"https://reddit.com{submission.permalink}",
            "author": str(submission.author),
            "created_utc": submission.created_utc,
            "score": submission.score,
            "num_comments": submission.num_comments,
            "subreddit": str(submission.subreddit),
            "matched": keywords_match(text),
        })
    return results


def search_by_keywords(
    subreddits: str = "all",
    query: Optional[str] = None,
    limit: int = 25,
) -> list[dict]:
    """Search subreddits by keyword query."""
    reddit = _get_reddit()
    subreddit = reddit.subreddit(subreddits)
    q = query or " OR ".join(KEYWORDS[:5])

    results = _call_with_backoff(
        subreddit.search, q, limit=limit, sort="new",
        operation_id=f"search_keywords_{subreddits[:12]}_{q[:20]}",
    )

    output = []
    for submission in results:
        text = f"{submission.title} {submission.selftext}"
        output.append({
            "id": submission.id,
            "title": submission.title,
            "text": submission.selftext[:500] if submission.selftext else "",
            "url": f"https://reddit.com{submission.permalink}",
            "author": str(submission.author),
            "created_utc": submission.created_utc,
            "score": submission.score,
            "num_comments": submission.num_comments,
            "subreddit": str(submission.subreddit),
            "matched": keywords_match(text),
        })
    return output


def reply_to_submission(submission_id: str, reply_text: str) -> Optional[str]:
    """Reply to a Reddit submission."""
    reddit = _get_reddit()

    try:
        submission = _call_with_backoff(
            reddit.submission, id=submission_id,
            operation_id=f"fetch_submission_{submission_id}",
        )
        comment = _call_with_backoff(
            submission.reply, reply_text,
            operation_id=f"reply_submission_{submission_id}",
        )
    except Exception as e:
        logger.error("Error replying to submission %s: %s", submission_id, e)
        return None

    logger.info("Replied to Reddit submission %s with comment %s", submission_id, comment.id)
    return comment.id


def reply_to_comment(comment_id: str, reply_text: str) -> Optional[str]:
    """Reply to an existing Reddit comment."""
    reddit = _get_reddit()

    try:
        comment_obj = _call_with_backoff(
            reddit.comment, comment_id,
            operation_id=f"fetch_comment_{comment_id}",
        )
        reply = _call_with_backoff(
            comment_obj.reply, reply_text,
            operation_id=f"reply_comment_{comment_id}",
        )
    except Exception as e:
        logger.error("Error replying to comment %s: %s", comment_id, e)
        return None

    logger.info("Replied to Reddit comment %s with comment %s", comment_id, reply.id)
    return reply.id


def verify_auth() -> str:
    """Verify Reddit authentication by fetching the current user."""
    reddit = _get_reddit()
    user = _call_with_backoff(
        reddit.user.me,
        operation_id="verify_auth",
    )
    logger.info("Reddit auth verified: %s", user)
    return str(user)


# ---------------------------------------------------------------------------
# RedditEngager class
# ---------------------------------------------------------------------------


class RedditEngager:
    """Convenience wrapper around the Reddit engagement functions."""

    def __init__(self) -> None:
        self.reddit = _get_reddit()

    def verify(self) -> str:
        return str(_call_with_backoff(
            self.reddit.user.me,
            operation_id="engager_verify",
        ))

    def search(self, subreddits: str = "MCP+opensource+devtools", limit: int = 25) -> list[dict]:
        query = " OR ".join(KEYWORDS)
        return search_by_keywords(subreddits, query=query, limit=limit)

    def search_keywords(self, query: Optional[str] = None, limit: int = 25) -> list[dict]:
        return search_by_keywords("all", query, limit)

    def reply(self, submission_id: str, text: str) -> Optional[str]:
        return reply_to_submission(submission_id, text)
