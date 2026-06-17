"""Social Media Poster tools — auto-publish with retry/reconnect."""

from __future__ import annotations

import json
import time
from typing import Optional
from tools.registry import tool_error, tool_result


# ---------------------------------------------------------------------------
# Retry logic
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
RETRY_DELAYS = [2, 5, 10]  # exponential backoff seconds


def _retry_with_reconnect(func, platform: str, *args, **kwargs) -> dict:
    """Execute func with auto-reconnect on failure."""
    from plugins.chrome_connector.manager import get_manager

    manager = get_manager()
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            # Check health first
            health = manager.check_health(platform)
            if not health.get("cdp_ready"):
                # Try to restart
                manager.stop(platform)
                time.sleep(1)
                manager.start(platform, headless=True)
                time.sleep(3)

            # Execute the operation
            result = func(manager, *args, **kwargs)
            if isinstance(result, dict) and result.get("error"):
                raise Exception(result["error"])
            return {"success": True, "data": result, "attempts": attempt + 1}

        except Exception as e:
            last_error = str(e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAYS[attempt])
                # Force reconnect
                try:
                    manager.stop(platform)
                    time.sleep(1)
                    manager.start(platform, headless=True)
                    time.sleep(3)
                except Exception:
                    pass

    return {"success": False, "error": f"Failed after {MAX_RETRIES} attempts: {last_error}"}


# ---------------------------------------------------------------------------
# Tool Schemas
# ---------------------------------------------------------------------------

SM_POST_SCHEMA = {
    "name": "sm_post",
    "description": "Post content to a social platform with auto-retry and reconnect. Supports Twitter, LinkedIn, Reddit, Threads, HN.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["twitter", "linkedin", "reddit", "threads", "hackernews"],
                "description": "Platform to post to",
            },
            "text": {
                "type": "string",
                "description": "Content to post",
            },
            "title": {
                "type": "string",
                "description": "Title for HN/Reddit posts",
            },
            "url": {
                "type": "string",
                "description": "URL for link posts (HN, Reddit)",
            },
            "subreddit": {
                "type": "string",
                "description": "Subreddit for Reddit posts",
            },
        },
        "required": ["platform", "text"],
    },
}

SM_COMMENT_SCHEMA = {
    "name": "sm_comment",
    "description": "Post a comment/reply with auto-retry and reconnect.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["twitter", "linkedin", "reddit", "threads", "hackernews"],
                "description": "Platform to comment on",
            },
            "url": {
                "type": "string",
                "description": "URL of the post to comment on",
            },
            "text": {
                "type": "string",
                "description": "Comment content",
            },
        },
        "required": ["platform", "url", "text"],
    },
}

SM_BATCH_POST_SCHEMA = {
    "name": "sm_batch_post",
    "description": "Post to multiple platforms with rate limiting. Returns results for each platform.",
    "parameters": {
        "type": "object",
        "properties": {
            "platforms": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of platforms to post to",
            },
            "text": {
                "type": "string",
                "description": "Content to post",
            },
            "title": {
                "type": "string",
                "description": "Title for HN/Reddit posts",
            },
            "url": {
                "type": "string",
                "description": "URL for link posts",
            },
            "delay_between": {
                "type": "integer",
                "description": "Seconds between posts (default: 5)",
            },
        },
        "required": ["platforms", "text"],
    },
}

SM_HEALTH_SCHEMA = {
    "name": "sm_health",
    "description": "Check health of all social media Chrome connections. Shows which platforms are ready.",
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


# ---------------------------------------------------------------------------
# Platform-specific post functions
# ---------------------------------------------------------------------------

def _post_twitter(manager, text: str, **kw) -> dict:
    """Post a tweet via CDP."""
    from plugins.chrome_connector.platforms.twitter import TwitterCDP
    handler = TwitterCDP(manager)
    return handler.post_tweet(text)


def _post_linkedin(manager, text: str, **kw) -> dict:
    """Post to LinkedIn via CDP."""
    from plugins.chrome_connector.platforms.linkedin import LinkedInCDP
    handler = LinkedInCDP(manager)
    return handler.post(text)


def _post_reddit(manager, text: str, url: str = "", **kw) -> dict:
    """Post to Reddit via CDP."""
    from plugins.chrome_connector.platforms.reddit import RedditCDP
    handler = RedditCDP(manager)
    if url:
        return handler.post_comment(url, text)
    return {"error": "Reddit requires a URL to comment on"}


def _post_threads(manager, text: str, **kw) -> dict:
    """Post to Threads via CDP."""
    from plugins.chrome_connector.platforms.threads import ThreadsCDP
    handler = ThreadsCDP(manager)
    return handler.post(text)


def _post_hackernews(manager, text: str, title: str = "", url: str = "", **kw) -> dict:
    """Post to Hacker News via CDP."""
    from plugins.chrome_connector.platforms.hackernews import HackerNewsCDP
    handler = HackerNewsCDP(manager)
    return handler.post(title=title or text[:100], url=url, text=text)


POST_HANDLERS = {
    "twitter": _post_twitter,
    "linkedin": _post_linkedin,
    "reddit": _post_reddit,
    "threads": _post_threads,
    "hackernews": _post_hackernews,
}


# ---------------------------------------------------------------------------
# Tool Handlers
# ---------------------------------------------------------------------------

def _handle_sm_post(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    text = args.get("text", "")
    if not platform or not text:
        return tool_error("platform and text are required")

    handler = POST_HANDLERS.get(platform)
    if not handler:
        return tool_error(f"Unsupported platform: {platform}")

    result = _retry_with_reconnect(
        handler, platform, text,
        title=args.get("title", ""),
        url=args.get("url", ""),
    )
    return tool_result(result)


def _handle_sm_comment(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    url = args.get("url", "")
    text = args.get("text", "")
    if not platform or not url or not text:
        return tool_error("platform, url, and text are required")

    def _comment(manager, url, text):
        from plugins.chrome_connector.platforms import get_handler
        handler = get_handler(platform)
        if not handler:
            return {"error": f"No handler for {platform}"}
        if platform == "twitter":
            return handler.post_comment(url, text)
        elif platform == "linkedin":
            return handler.comment(url, text)
        elif platform == "reddit":
            return handler.post_comment(url, text)
        elif platform == "threads":
            return handler.comment(url, text)
        elif platform == "hackernews":
            item_id = url.split("id=")[-1] if "id=" in url else url.split("/")[-1]
            return handler.post_comment(item_id, text)
        return {"error": f"Comment not supported for {platform}"}

    result = _retry_with_reconnect(_comment, platform, url, text)
    return tool_result(result)


def _handle_sm_batch_post(args: dict, **kw) -> str:
    platforms = args.get("platforms", [])
    text = args.get("text", "")
    if not platforms or not text:
        return tool_error("platforms and text are required")

    delay = args.get("delay_between", 5)
    results = {}

    for platform in platforms:
        handler = POST_HANDLERS.get(platform)
        if not handler:
            results[platform] = {"success": False, "error": f"Unsupported: {platform}"}
            continue

        result = _retry_with_reconnect(
            handler, platform, text,
            title=args.get("title", ""),
            url=args.get("url", ""),
        )
        results[platform] = result

        # Rate limit between posts
        if platform != platforms[-1]:
            time.sleep(delay)

    return tool_result(results)


def _handle_sm_health(args: dict, **kw) -> str:
    from plugins.chrome_connector.manager import get_manager
    manager = get_manager()

    health = {}
    for platform in ["twitter", "linkedin", "reddit", "threads", "hackernews"]:
        h = manager.check_health(platform)
        health[platform] = {
            "status": "ready" if h.get("cdp_ready") else "offline",
            "cookies": h.get("has_cookies", False),
            "port": h.get("port"),
        }

    return tool_result(health)
