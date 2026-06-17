"""Chrome Connector tools for Hermes — registered via plugins/chrome_connector."""

from __future__ import annotations

import json
from tools.registry import tool_error, tool_result


def _check_chrome_available() -> bool:
    """Check if Chrome is available on the system."""
    import os
    return os.path.exists("/opt/google/chrome/chrome")


def _get_manager():
    from plugins.chrome_connector.manager import get_manager
    return get_manager()


def _get_handler(platform: str):
    from plugins.chrome_connector.platforms import get_handler
    return get_handler(platform)


# ---------------------------------------------------------------------------
# Tool Schemas
# ---------------------------------------------------------------------------

CHROME_STATUS_SCHEMA = {
    "name": "chrome_status",
    "description": "Check status of all Chrome browser profiles (running, cookies, ports). Use to see which platforms are connected.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "description": "Optional: check specific platform (twitter, linkedin, reddit, threads, hackernews, discord)",
            },
        },
        "required": [],
    },
}

CHROME_START_SCHEMA = {
    "name": "chrome_start",
    "description": "Start a Chrome browser profile for a social platform. Creates persistent session with cookies.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["twitter", "linkedin", "reddit", "threads", "hackernews", "discord"],
                "description": "Platform to start Chrome for",
            },
            "headless": {
                "type": "boolean",
                "description": "Run in headless mode (default: true)",
            },
        },
        "required": ["platform"],
    },
}

CHROME_STOP_SCHEMA = {
    "name": "chrome_stop",
    "description": "Stop a Chrome browser profile. Saves cookies for next session.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["twitter", "linkedin", "reddit", "threads", "hackernews", "discord"],
                "description": "Platform to stop Chrome for",
            },
        },
        "required": ["platform"],
    },
}

CHROME_POST_SCHEMA = {
    "name": "chrome_post",
    "description": "Post content to a social platform via Chrome. Supports tweet, LinkedIn post, Reddit post, Threads post, HN submission.",
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

CHROME_READ_SCHEMA = {
    "name": "chrome_read",
    "description": "Read content from a social platform URL. Extracts post content, comments, author info.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["twitter", "linkedin", "reddit", "threads", "hackernews", "discord"],
                "description": "Platform to read from",
            },
            "url": {
                "type": "string",
                "description": "URL of the post/thread to read",
            },
            "limit": {
                "type": "integer",
                "description": "Max items to read (default: 20)",
            },
        },
        "required": ["platform", "url"],
    },
}

CHROME_SEARCH_SCHEMA = {
    "name": "chrome_search",
    "description": "Search a social platform for content. Returns relevant posts/threads.",
    "parameters": {
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["twitter", "linkedin", "reddit", "threads", "hackernews"],
                "description": "Platform to search",
            },
            "query": {
                "type": "string",
                "description": "Search query",
            },
            "subreddit": {
                "type": "string",
                "description": "Subreddit to search (Reddit only)",
            },
            "limit": {
                "type": "integer",
                "description": "Max results (default: 10)",
            },
        },
        "required": ["platform", "query"],
    },
}

CHROME_COMMENT_SCHEMA = {
    "name": "chrome_comment",
    "description": "Post a comment/reply on a social platform post.",
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


# ---------------------------------------------------------------------------
# Tool Handlers
# ---------------------------------------------------------------------------

def _handle_chrome_status(args: dict, **kw) -> str:
    manager = _get_manager()
    platform = args.get("platform")

    if platform:
        result = manager.check_health(platform)
    else:
        result = manager.list_platforms()

    return tool_result(result)


def _handle_chrome_start(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    if not platform:
        return tool_error("platform is required")

    headless = args.get("headless", True)
    if isinstance(headless, str):
        headless = headless.lower() in ("true", "1", "yes")

    manager = _get_manager()
    result = manager.start(platform, headless=headless)
    return tool_result(result)


def _handle_chrome_stop(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    if not platform:
        return tool_error("platform is required")

    manager = _get_manager()
    result = manager.stop(platform)
    return tool_result(result)


def _handle_chrome_post(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    text = args.get("text", "")
    if not platform or not text:
        return tool_error("platform and text are required")

    handler = _get_handler(platform)
    if not handler:
        return tool_error(f"No handler for platform: {platform}")

    try:
        if platform == "twitter":
            result = handler.post_tweet(text)
        elif platform == "linkedin":
            result = handler.post(text)
        elif platform == "reddit":
            result = handler.post_comment(args.get("url", ""), text)
        elif platform == "threads":
            result = handler.post(text)
        elif platform == "hackernews":
            result = handler.post(
                title=args.get("title", text[:100]),
                url=args.get("url"),
                text=text,
            )
        else:
            return tool_error(f"Post not supported for: {platform}")

        return tool_result(result)
    except Exception as e:
        return tool_error(f"Post failed: {e}")


def _handle_chrome_read(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    url = args.get("url", "")
    if not platform or not url:
        return tool_error("platform and url are required")

    handler = _get_handler(platform)
    if not handler:
        return tool_error(f"No handler for platform: {platform}")

    try:
        if platform == "discord":
            result = handler.read_channel(url, limit=args.get("limit", 20))
        else:
            result = handler.read_thread(url)
        return tool_result(result)
    except Exception as e:
        return tool_error(f"Read failed: {e}")


def _handle_chrome_search(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    query = args.get("query", "")
    if not platform or not query:
        return tool_error("platform and query are required")

    handler = _get_handler(platform)
    if not handler:
        return tool_error(f"No handler for platform: {platform}")

    try:
        if platform == "reddit":
            result = handler.search(query, subreddit=args.get("subreddit"))
        elif platform == "twitter":
            result = handler.search(query, limit=args.get("limit", 10))
        else:
            result = handler.search(query)
        return tool_result(result)
    except Exception as e:
        return tool_error(f"Search failed: {e}")


def _handle_chrome_comment(args: dict, **kw) -> str:
    platform = args.get("platform", "")
    url = args.get("url", "")
    text = args.get("text", "")
    if not platform or not url or not text:
        return tool_error("platform, url, and text are required")

    handler = _get_handler(platform)
    if not handler:
        return tool_error(f"No handler for platform: {platform}")

    try:
        if platform == "twitter":
            result = handler.post_comment(url, text)
        elif platform == "linkedin":
            result = handler.comment(url, text)
        elif platform == "reddit":
            result = handler.post_comment(url, text)
        elif platform == "threads":
            result = handler.comment(url, text)
        elif platform == "hackernews":
            # Extract item ID from URL
            item_id = url.split("id=")[-1] if "id=" in url else url.split("/")[-1]
            result = handler.post_comment(item_id, text)
        else:
            return tool_error(f"Comment not supported for: {platform}")

        return tool_result(result)
    except Exception as e:
        return tool_error(f"Comment failed: {e}")
