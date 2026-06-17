"""Trend Scanner tools — real-time trend scanning for guerrilla marketing."""

from __future__ import annotations

import json
import time
from typing import Optional
from tools.registry import tool_error, tool_result


# ---------------------------------------------------------------------------
# Retry logic
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
RETRY_DELAYS = [2, 5, 10]


def _retry_scan(func, platform: str, *args, **kwargs) -> dict:
    """Execute scan with auto-reconnect on failure."""
    from plugins.chrome_connector.manager import get_manager

    manager = get_manager()
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            # Check health
            health = manager.check_health(platform)
            if not health.get("cdp_ready"):
                manager.stop(platform)
                time.sleep(1)
                manager.start(platform, headless=True)
                time.sleep(3)

            result = func(manager, *args, **kwargs)
            if isinstance(result, dict) and result.get("error"):
                raise Exception(result["error"])
            return {"success": True, "data": result, "attempts": attempt + 1}

        except Exception as e:
            last_error = str(e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAYS[attempt])
                try:
                    manager.stop(platform)
                    time.sleep(1)
                    manager.start(platform, headless=True)
                    time.sleep(3)
                except Exception:
                    pass

    return {"success": False, "error": f"Failed after {MAX_RETRIES} attempts: {last_error}"}


# ---------------------------------------------------------------------------
# Platform scanners
# ---------------------------------------------------------------------------

def _scan_reddit(manager, query: str, subreddits: list = None, limit: int = 10) -> dict:
    """Scan Reddit for trending content."""
    from plugins.chrome_connector.platforms.reddit import RedditCDP
    handler = RedditCDP(manager)

    results = []
    target_subs = subreddits or ["all"]

    for sub in target_subs:
        try:
            search_result = handler.search(query, subreddit=sub if sub != "all" else None)
            if isinstance(search_result, dict) and "posts" in search_result:
                for post in search_result["posts"][:limit]:
                    results.append({
                        "platform": "reddit",
                        "subreddit": sub,
                        "title": post.get("title", ""),
                        "url": post.get("url", ""),
                        "score": post.get("score", 0),
                        "comments": post.get("comments", 0),
                    })
        except Exception as e:
            results.append({"platform": "reddit", "subreddit": sub, "error": str(e)})

    return {"results": results, "total": len(results)}


def _scan_twitter(manager, query: str, limit: int = 10) -> dict:
    """Scan Twitter for trending content."""
    from plugins.chrome_connector.platforms.twitter import TwitterCDP
    handler = TwitterCDP(manager)

    try:
        search_result = handler.search(query, limit=limit)
        if isinstance(search_result, dict) and "tweets" in search_result:
            results = []
            for tweet in search_result["tweets"]:
                results.append({
                    "platform": "twitter",
                    "author": tweet.get("author", ""),
                    "text": tweet.get("text", ""),
                    "likes": tweet.get("likes", 0),
                    "retweets": tweet.get("retweets", 0),
                    "time": tweet.get("time", ""),
                })
            return {"results": results, "total": len(results)}
    except Exception as e:
        return {"results": [], "error": str(e)}

    return {"results": [], "total": 0}


def _scan_hackernews(manager, query: str, limit: int = 10) -> dict:
    """Scan Hacker News for trending content."""
    from plugins.chrome_connector.platforms.hackernews import HackerNewsCDP
    handler = HackerNewsCDP(manager)

    try:
        search_result = handler.search(query)
        if isinstance(search_result, dict) and "stories" in search_result:
            results = []
            for story in search_result["stories"][:limit]:
                results.append({
                    "platform": "hackernews",
                    "title": story.get("title", ""),
                    "url": story.get("url", ""),
                    "score": story.get("score", 0),
                    "comments": story.get("comments", 0),
                    "time": story.get("time", ""),
                })
            return {"results": results, "total": len(results)}
    except Exception as e:
        return {"results": [], "error": str(e)}

    return {"results": [], "total": 0}


# ---------------------------------------------------------------------------
# Tool Schemas
# ---------------------------------------------------------------------------

TREND_SCAN_SCHEMA = {
    "name": "trend_scan",
    "description": "Scan multiple platforms for trending content matching a query. Returns ranked results.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query to scan for",
            },
            "platforms": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Platforms to scan (default: all)",
            },
            "subreddits": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Specific subreddits to scan (Reddit only)",
            },
            "limit": {
                "type": "integer",
                "description": "Max results per platform (default: 10)",
            },
        },
        "required": ["query"],
    },
}

TREND_WATCH_SCHEMA = {
    "name": "trend_watch",
    "description": "Set up a watch on specific keywords/topics. Returns alerts when new matching content appears.",
    "parameters": {
        "type": "object",
        "properties": {
            "keywords": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Keywords to watch for",
            },
            "platforms": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Platforms to watch",
            },
            "min_score": {
                "type": "integer",
                "description": "Minimum score to trigger alert (default: 5)",
            },
        },
        "required": ["keywords"],
    },
}

TREND_REPORT_SCHEMA = {
    "name": "trend_report",
    "description": "Generate a trend report from cached scan results. Shows top opportunities for guerrilla marketing.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Filter report by query",
            },
            "platform": {
                "type": "string",
                "description": "Filter by platform",
            },
            "min_engagement": {
                "type": "integer",
                "description": "Minimum engagement score (default: 10)",
            },
        },
        "required": [],
    },
}


# ---------------------------------------------------------------------------
# In-memory cache for scan results
# ---------------------------------------------------------------------------

_scan_cache: dict = {}


# ---------------------------------------------------------------------------
# Tool Handlers
# ---------------------------------------------------------------------------

def _handle_trend_scan(args: dict, **kw) -> str:
    query = args.get("query", "")
    if not query:
        return tool_error("query is required")

    platforms = args.get("platforms", ["reddit", "twitter", "hackernews"])
    subreddits = args.get("subreddits", [])
    limit = args.get("limit", 10)

    all_results = {}

    for platform in platforms:
        if platform == "reddit":
            result = _retry_scan(_scan_reddit, platform, query, subreddits, limit)
        elif platform == "twitter":
            result = _retry_scan(_scan_twitter, platform, query, limit)
        elif platform == "hackernews":
            result = _retry_scan(_scan_hackernews, platform, query, limit)
        else:
            result = {"success": False, "error": f"Unsupported platform: {platform}"}

        all_results[platform] = result

    # Cache results
    _scan_cache[query] = {
        "timestamp": time.time(),
        "results": all_results,
    }

    return tool_result(all_results)


def _handle_trend_watch(args: dict, **kw) -> str:
    keywords = args.get("keywords", [])
    if not keywords:
        return tool_error("keywords are required")

    platforms = args.get("platforms", ["reddit", "twitter", "hackernews"])
    min_score = args.get("min_score", 5)

    alerts = []

    for keyword in keywords:
        for platform in platforms:
            try:
                if platform == "reddit":
                    result = _retry_scan(_scan_reddit, platform, keyword, [], 5)
                elif platform == "twitter":
                    result = _retry_scan(_scan_twitter, platform, keyword, 5)
                elif platform == "hackernews":
                    result = _retry_scan(_scan_hackernews, platform, keyword, 5)
                else:
                    continue

                if result.get("success") and result.get("data", {}).get("results"):
                    for item in result["data"]["results"]:
                        score = item.get("score", 0) + item.get("likes", 0)
                        if score >= min_score:
                            alerts.append({
                                "keyword": keyword,
                                "platform": platform,
                                "item": item,
                                "score": score,
                            })
            except Exception:
                pass

    # Sort by score
    alerts.sort(key=lambda x: x["score"], reverse=True)

    return tool_result({
        "alerts": alerts,
        "total": len(alerts),
        "keywords_watched": keywords,
    })


def _handle_trend_report(args: dict, **kw) -> str:
    query = args.get("query")
    platform = args.get("platform")
    min_engagement = args.get("min_engagement", 10)

    # Get from cache or do fresh scan
    if query and query in _scan_cache:
        cached = _scan_cache[query]
        results = cached["results"]
    else:
        results = _scan_cache

    # Filter and rank opportunities
    opportunities = []

    for q, data in results.items():
        if query and q != query:
            continue

        for plat, plat_data in data.get("results", {}).items():
            if platform and plat != platform:
                continue

            if plat_data.get("success") and plat_data.get("data", {}).get("results"):
                for item in plat_data["data"]["results"]:
                    engagement = (
                        item.get("score", 0) +
                        item.get("likes", 0) +
                        item.get("comments", 0) * 2
                    )
                    if engagement >= min_engagement:
                        opportunities.append({
                            "query": q,
                            "platform": plat,
                            "engagement": engagement,
                            "item": item,
                            "action": "reply" if plat in ["reddit", "twitter", "hackernews"] else "post",
                        })

    # Sort by engagement
    opportunities.sort(key=lambda x: x["engagement"], reverse=True)

    return tool_result({
        "opportunities": opportunities[:20],  # Top 20
        "total": len(opportunities),
        "cached_queries": list(_scan_cache.keys()),
    })
