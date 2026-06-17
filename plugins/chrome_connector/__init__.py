"""Chrome Connector plugin — bundled, auto-loaded.

Unified Chrome Browser profile management for social platforms.
Manages Chrome instances via CDP for Twitter/X, LinkedIn, Reddit,
Threads, Hacker News, and Discord. Provides persistent sessions,
auto-restart, health checks, and platform-specific operations.

Always-on features:
- pre_tool_call hook: auto-reconnect before any chrome_* tool call
- Background health monitor: checks connections every 60s
- Auto-restart: restarts crashed Chrome instances
"""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

from plugins.chrome_connector.tools import (
    CHROME_STATUS_SCHEMA,
    CHROME_START_SCHEMA,
    CHROME_STOP_SCHEMA,
    CHROME_POST_SCHEMA,
    CHROME_READ_SCHEMA,
    CHROME_SEARCH_SCHEMA,
    CHROME_COMMENT_SCHEMA,
    _check_chrome_available,
    _handle_chrome_status,
    _handle_chrome_start,
    _handle_chrome_stop,
    _handle_chrome_post,
    _handle_chrome_read,
    _handle_chrome_search,
    _handle_chrome_comment,
)

_TOOLS = (
    ("chrome_status",  CHROME_STATUS_SCHEMA,  _handle_chrome_status,  "📊"),
    ("chrome_start",   CHROME_START_SCHEMA,   _handle_chrome_start,   "🚀"),
    ("chrome_stop",    CHROME_STOP_SCHEMA,    _handle_chrome_stop,    "🛑"),
    ("chrome_post",    CHROME_POST_SCHEMA,    _handle_chrome_post,    "📝"),
    ("chrome_read",    CHROME_READ_SCHEMA,    _handle_chrome_read,    "📖"),
    ("chrome_search",  CHROME_SEARCH_SCHEMA,  _handle_chrome_search,  "🔍"),
    ("chrome_comment", CHROME_COMMENT_SCHEMA, _handle_chrome_comment, "💬"),
)

# Background monitor state
_monitor_thread: threading.Thread | None = None
_monitor_stop = threading.Event()
HEALTH_CHECK_INTERVAL = 60  # seconds


def _health_monitor():
    """Background thread that monitors Chrome health and auto-restarts."""
    from plugins.chrome_connector.manager import get_manager, PLATFORM_CONFIGS

    manager = get_manager()
    logger.info("[chrome_connector] Health monitor started")

    while not _monitor_stop.is_set():
        try:
            for platform, config in PLATFORM_CONFIGS.items():
                health = manager.check_health(platform)
                if not health.get("process_running") and health.get("has_cookies"):
                    # Chrome crashed but we have cookies — restart it
                    logger.info(f"[chrome_connector] Auto-restarting {platform}")
                    try:
                        manager.start(platform, headless=True)
                    except Exception as e:
                        logger.warning(f"[chrome_connector] Failed to restart {platform}: {e}")
        except Exception as e:
            logger.warning(f"[chrome_connector] Health monitor error: {e}")

        _monitor_stop.wait(HEALTH_CHECK_INTERVAL)

    logger.info("[chrome_connector] Health monitor stopped")


def _pre_tool_call_hook(tool_name: str, tool_args: dict, **kwargs) -> dict | None:
    """Hook before chrome_* tool calls — ensure connection is ready."""
    if not tool_name.startswith("chrome_"):
        return None  # Not a chrome tool, skip

    platform = tool_args.get("platform")
    if not platform:
        return None

    from plugins.chrome_connector.manager import get_manager
    manager = get_manager()

    health = manager.check_health(platform)
    if not health.get("cdp_ready"):
        # Try to restart
        logger.info(f"[chrome_connector] Pre-hook: restarting {platform}")
        try:
            manager.stop(platform)
            time.sleep(1)
            manager.start(platform, headless=True)
            time.sleep(3)
        except Exception as e:
            logger.warning(f"[chrome_connector] Pre-hook restart failed: {e}")

    return None  # Don't block the tool call


def register(ctx) -> None:
    """Register all Chrome Connector tools and hooks."""
    # Register tools
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="chrome_connector",
            schema=schema,
            handler=handler,
            check_fn=_check_chrome_available,
            emoji=emoji,
        )

    # Register pre_tool_call hook for auto-reconnect
    ctx.register_hook("pre_tool_call", _pre_tool_call_hook)

    # Start background health monitor
    global _monitor_thread
    if _monitor_thread is None or not _monitor_thread.is_alive():
        _monitor_stop.clear()
        _monitor_thread = threading.Thread(target=_health_monitor, daemon=True)
        _monitor_thread.start()
        logger.info("[chrome_connector] Background health monitor started")
