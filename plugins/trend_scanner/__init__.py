"""Trend Scanner plugin — real-time trend scanning for guerrilla marketing.

Scans multiple platforms simultaneously:
- Reddit (subreddits, comments, posts)
- Twitter/X (hashtags, keywords, mentions)
- Hacker News (stories, comments)
- Google Trends (rising topics)

Always-on features:
- Background trend watcher: monitors keywords every 5 minutes
- Alert system: notifies when high-value content appears
- Auto-scan: triggers scan on pre_tool_call for marketing tools
"""

from __future__ import annotations

import json
import logging
import threading
import time

logger = logging.getLogger(__name__)

from plugins.trend_scanner.tools import (
    TREND_SCAN_SCHEMA,
    TREND_WATCH_SCHEMA,
    TREND_REPORT_SCHEMA,
    _handle_trend_scan,
    _handle_trend_watch,
    _handle_trend_report,
)

_TOOLS = (
    ("trend_scan",    TREND_SCAN_SCHEMA,    _handle_trend_scan,    "🔍"),
    ("trend_watch",   TREND_WATCH_SCHEMA,   _handle_trend_watch,   "👁️"),
    ("trend_report",  TREND_REPORT_SCHEMA,  _handle_trend_report,  "📊"),
)

# Background watcher state
_watcher_thread: threading.Thread | None = None
_watcher_stop = threading.Event()
_watched_keywords: list = []
WATCH_INTERVAL = 300  # 5 minutes
_alerts: list = []


def _trend_watcher():
    """Background thread that monitors keywords for new content."""
    from plugins.trend_scanner.tools import _retry_scan, _scan_reddit, _scan_twitter, _scan_hackernews

    logger.info("[trend_scanner] Background watcher started")

    while not _watcher_stop.is_set():
        try:
            for keyword in _watched_keywords:
                # Scan each platform
                for platform, scanner in [
                    ("reddit", _scan_reddit),
                    ("twitter", _scan_twitter),
                    ("hackernews", _scan_hackernews),
                ]:
                    try:
                        result = _retry_scan(scanner, platform, keyword, [], 5)
                        if result.get("success") and result.get("data", {}).get("results"):
                            for item in result["data"]["results"]:
                                score = item.get("score", 0) + item.get("likes", 0)
                                if score >= 10:  # High engagement
                                    alert = {
                                        "keyword": keyword,
                                        "platform": platform,
                                        "item": item,
                                        "score": score,
                                        "timestamp": time.time(),
                                    }
                                    _alerts.append(alert)
                                    logger.info(f"[trend_scanner] Alert: {keyword} on {platform} (score={score})")
                    except Exception as e:
                        logger.debug(f"[trend_scanner] Scan error for {platform}/{keyword}: {e}")
        except Exception as e:
            logger.warning(f"[trend_scanner] Watcher error: {e}")

        _watcher_stop.wait(WATCH_INTERVAL)

    logger.info("[trend_scanner] Background watcher stopped")


def _pre_tool_call_hook(tool_name: str, tool_args: dict, **kwargs) -> dict | None:
    """Hook before sm_* tool calls — auto-scan for relevant trends."""
    if tool_name not in ("sm_post", "sm_comment"):
        return None

    text = tool_args.get("text", "").lower()
    if not text:
        return None

    # Quick scan for related content
    try:
        from plugins.trend_scanner.tools import _retry_scan, _scan_reddit
        # Extract keywords (simple: split by spaces, take first 3)
        keywords = [w for w in text.split() if len(w) > 3][:3]
        if keywords:
            query = " ".join(keywords)
            result = _retry_scan(_scan_reddit, "reddit", query, [], 3)
            if result.get("success") and result.get("data", {}).get("results"):
                # Add context to tool args
                tool_args["_trend_context"] = result["data"]["results"][:3]
    except Exception:
        pass

    return None


def register(ctx) -> None:
    """Register all Trend Scanner tools and hooks."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="trend_scanner",
            schema=schema,
            handler=handler,
            emoji=emoji,
        )

    # Register hooks
    ctx.register_hook("pre_tool_call", _pre_tool_call_hook)

    # Start background watcher
    global _watcher_thread
    if _watcher_thread is None or not _watcher_thread.is_alive():
        _watcher_stop.clear()
        _watcher_thread = threading.Thread(target=_trend_watcher, daemon=True)
        _watcher_thread.start()
        logger.info("[trend_scanner] Background watcher started")


def add_watched_keyword(keyword: str) -> None:
    """Add a keyword to the background watcher."""
    if keyword not in _watched_keywords:
        _watched_keywords.append(keyword)
        logger.info(f"[trend_scanner] Watching keyword: {keyword}")


def get_alerts() -> list:
    """Get recent alerts from the background watcher."""
    return _alerts[-50:]  # Last 50 alerts
