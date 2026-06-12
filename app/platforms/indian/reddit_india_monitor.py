"""Reddit r/developersIndia engagement monitor with rate-limit resilience.

Provides:
    - monitor_subreddit()
    - search_subreddit()
    - reply_to_post()
    - reply_to_comment()
    - get_ama_schedule()
    - browse_hot()

All PRAW API calls are wrapped with exponential backoff + jitter to handle
HTTP 429 (rate limited) and HTTP 403 (IP banned) gracefully.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Optional

from app.platforms.reddit_auth import get_reddit_client
from app.platforms.reddit_ratelimit import (
    RedditRateLimiter,
    call_with_backoff,
    handle_http_error,
    is_rate_limit_error,
    reddit_proxy_pool,
    reddit_rate_limiter,
    rotate_user_agent,
)

logger = logging.getLogger(__name__)

TARGET_SUBREDDIT = "developersIndia"
KEYWORDS = ["mcp", "opensource", "openclaw", "fossunited", "modelcontextprotocol"]

# ---------------------------------------------------------------------------
# Engagement logger
# ---------------------------------------------------------------------------


def _log_engagement(platform: str, action: str, status: str, metadata: dict = None):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
        from indian_engagement_logger import log_event  # type: ignore[import-untyped]

        log_event(platform=platform, action=action, status=status, metadata=metadata or {})
    except Exception as e:
        logger.warning("Engagement log failed: %s", e)


# ---------------------------------------------------------------------------
# Generic PRAW call wrapper with backoff
# ---------------------------------------------------------------------------


def _call_with_backoff(fn, *args, operation_id: str = "default", **kwargs):
    """Execute a PRAW callable with exponential backoff + jitter.

    This wraps *call_with_backoff* (from ``app.platforms.reddit_ratelimit``)
    with additional logging of block events.

    Args:
        fn: The callable (e.g. ``subreddit.hot``).
        operation_id: A unique label for backoff-state tracking.
        *args: Forwarded to *fn*.
        **kwargs: Forwarded to *fn*.

    Returns:
        The return value of *fn*.

    Raises:
        The last exception caught if all retries are exhausted.  Non-retryable
        exceptions (not rate-limit/ban-related) propagate immediately.
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
        # Log block events with detail for debugging
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
            _log_engagement(
                "reddit_india",
                "api_block",
                "failed",
                metadata={
                    "operation": operation_id,
                    "status_code": status_code,
                    "error": error_msg[:500],
                    "user_agent": rotate_user_agent(),
                },
            )
        raise


# ---------------------------------------------------------------------------
# API functions
# ---------------------------------------------------------------------------


def monitor_subreddit(query: str = None, limit: int = 25, sort: str = "hot") -> list[dict]:
    """Fetch posts from r/developersIndia, optionally filtering by keyword.

    Args:
        query: Keyword to filter posts by (case-insensitive match in title/selftext).
        limit: Maximum number of posts to fetch.
        sort: Sort order (``hot``, ``new``, ``top``, ``rising``).

    Returns:
        List of post dicts with id, title, url, score, num_comments, etc.
    """
    ua = rotate_user_agent()
    proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None
    reddit = get_reddit_client(proxy=proxy_url, user_agent=ua)
    subreddit = reddit.subreddit(TARGET_SUBREDDIT)

    sort_methods = {
        "hot": subreddit.hot,
        "new": subreddit.new,
        "top": subreddit.top,
        "rising": subreddit.rising,
    }
    method = sort_methods.get(sort, subreddit.hot)

    posts = _call_with_backoff(method, limit=limit, operation_id=f"monitor_{sort}")
    results = []
    for post in posts:
        if query is None or query.lower() in (post.title + " " + (post.selftext or "")).lower():
            results.append({
                "id": post.id,
                "title": post.title,
                "url": f"https://reddit.com{post.permalink}",
                "score": post.score,
                "num_comments": post.num_comments,
                "created_utc": post.created_utc,
                "author": str(post.author),
                "selftext_preview": (post.selftext or "")[:500],
            })
    return results


def search_subreddit(query: str, limit: int = 25, sort: str = "relevance") -> list[dict]:
    """Search r/developersIndia for posts matching *query*.

    Args:
        query: Search query string.
        limit: Maximum results.
        sort: Sort order (``relevance``, ``new``, ``top``, ``comments``).

    Yields:
        Post dicts one at a time (generator).
    """
    ua = rotate_user_agent()
    proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None
    reddit = get_reddit_client(proxy=proxy_url, user_agent=ua)
    subreddit = reddit.subreddit(TARGET_SUBREDDIT)

    sort_methods = {"relevance": "relevance", "new": "new", "top": "top", "comments": "comments"}
    sort_param = sort_methods.get(sort, "relevance")

    generator = _call_with_backoff(
        subreddit.search,
        query,
        sort=sort_param,
        limit=limit,
        operation_id=f"search_{query[:20]}",
    )
    for post in generator:
        yield {
            "id": post.id,
            "title": post.title,
            "url": f"https://reddit.com{post.permalink}",
            "score": post.score,
            "num_comments": post.num_comments,
            "created_utc": post.created_utc,
            "author": str(post.author),
            "selftext_preview": (post.selftext or "")[:500],
        }


def reply_to_post(post_url_or_id: str, reply_text: str) -> Optional[str]:
    """Reply to a Reddit submission by URL or ID.

    Args:
        post_url_or_id: Full URL (e.g. ``https://reddit.com/...``) or post ID.
        reply_text: Markdown reply body.

    Returns:
        The new comment ID, or ``None`` on failure.
    """
    ua = rotate_user_agent()
    proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None
    reddit = get_reddit_client(proxy=proxy_url, user_agent=ua)

    # Fetch submission
    try:
        submission = _call_with_backoff(
            reddit.submission, url=post_url_or_id,
            operation_id=f"fetch_submission_{post_url_or_id[-12:]}",
        )
    except Exception:
        try:
            submission = _call_with_backoff(
                reddit.submission, id=post_url_or_id,
                operation_id=f"fetch_submission_id_{post_url_or_id[:12]}",
            )
        except Exception as e:
            logger.error("Error fetching submission %s: %s", post_url_or_id, e)
            return None

    # Post reply
    try:
        comment = _call_with_backoff(
            submission.reply, reply_text,
            operation_id=f"reply_post_{submission.id}",
        )
    except Exception as e:
        logger.error("Error replying to submission %s: %s", post_url_or_id, e)
        _log_engagement(
            "reddit_india", "reply_to_post", "failed",
            {"post_id": post_url_or_id, "error": str(e)[:300]},
        )
        return None

    if comment:
        _log_engagement(
            "reddit_india", "reply_to_post", "success",
            {"post_id": submission.id, "comment_id": comment.id},
        )
        return comment.id
    return None


def reply_to_comment(comment_id: str, reply_text: str) -> Optional[str]:
    """Reply to an existing Reddit comment.

    Args:
        comment_id: The comment's base36 ID.
        reply_text: Markdown reply body.

    Returns:
        The new comment ID, or ``None`` on failure.
    """
    ua = rotate_user_agent()
    proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None
    reddit = get_reddit_client(proxy=proxy_url, user_agent=ua)

    try:
        comment = _call_with_backoff(
            reddit.comment, comment_id,
            operation_id=f"fetch_comment_{comment_id}",
        )
        reply = _call_with_backoff(
            comment.reply, reply_text,
            operation_id=f"reply_comment_{comment_id}",
        )
    except Exception as e:
        logger.error("Error replying to comment %s: %s", comment_id, e)
        _log_engagement(
            "reddit_india", "reply_to_comment", "failed",
            {"comment_id": comment_id, "error": str(e)[:300]},
        )
        return None

    if reply:
        _log_engagement(
            "reddit_india", "reply_to_comment", "success",
            {"comment_id": comment_id, "reply_id": reply.id},
        )
        return reply.id
    return None


def get_ama_schedule() -> list[dict]:
    """Search r/developersIndia for recent AMA posts.

    Returns:
        List of AMA post dicts.
    """
    ua = rotate_user_agent()
    proxy_url = reddit_proxy_pool.get_next_proxy() if reddit_proxy_pool.has_proxies else None
    reddit = get_reddit_client(proxy=proxy_url, user_agent=ua)
    subreddit = reddit.subreddit(TARGET_SUBREDDIT)

    posts = _call_with_backoff(
        subreddit.search, "AMA", sort="new", limit=10,
        operation_id="ama_schedule",
    )
    results = []
    for post in posts:
        is_ama = (
            "ama" in post.title.lower()
            or (post.link_flair_text and "ama" in post.link_flair_text.lower())
        )
        if is_ama:
            results.append({
                "id": post.id,
                "title": post.title,
                "url": f"https://reddit.com{post.permalink}",
                "author": str(post.author),
                "created_utc": post.created_utc,
                "num_comments": post.num_comments,
                "score": post.score,
            })
    return results


def browse_hot(limit: int = 25) -> list[dict]:
    """Convenience: return hot posts from r/developersIndia.

    Args:
        limit: Maximum number of posts to return.

    Returns:
        List of post dicts.
    """
    return monitor_subreddit(limit=limit, sort="hot")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="Reddit r/developersIndia engagement monitor")
    sub = parser.add_subparsers(dest="command", required=True)

    p_monitor = sub.add_parser("monitor", help="Monitor subreddit for keyword mentions")
    p_monitor.add_argument("--query")
    p_monitor.add_argument("--limit", type=int, default=25)
    p_monitor.add_argument("--sort", choices=["hot", "new", "top", "rising"], default="hot")

    p_search = sub.add_parser("search", help="Search subreddit")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=25)
    p_search.add_argument("--sort", choices=["relevance", "new", "top", "comments"], default="relevance")

    p_reply_post = sub.add_parser("reply-post", help="Reply to a post")
    p_reply_post.add_argument("--post", required=True)
    p_reply_post.add_argument("--text", required=True)

    p_reply_comment = sub.add_parser("reply-comment", help="Reply to a comment")
    p_reply_comment.add_argument("--comment-id", required=True)
    p_reply_comment.add_argument("--text", required=True)

    p_browse = sub.add_parser("browse", help="Browse hot posts")
    p_browse.add_argument("--limit", type=int, default=25)

    p_amas = sub.add_parser("amas", help="Check for AMA posts")

    args = parser.parse_args()

    if args.command == "monitor":
        results = monitor_subreddit(query=args.query, limit=args.limit, sort=args.sort)
        print(json.dumps(results, indent=2))
    elif args.command == "search":
        results = list(search_subreddit(args.query, limit=args.limit, sort=args.sort))
        print(json.dumps(results, indent=2))
    elif args.command == "reply-post":
        cid = reply_to_post(args.post, args.text)
        print(json.dumps({"comment_id": cid}))
    elif args.command == "reply-comment":
        rid = reply_to_comment(args.comment_id, args.text)
        print(json.dumps({"reply_id": rid}))
    elif args.command == "browse":
        posts = browse_hot(limit=args.limit)
        print(json.dumps(posts, indent=2))
    elif args.command == "amas":
        amas = get_ama_schedule()
        print(json.dumps(amas, indent=2))
