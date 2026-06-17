"""Social Media Poster plugin — auto-publish with retry/reconnect.

Wraps chrome_connector with:
- Auto-restart Chrome when connection drops
- Smart retry with exponential backoff
- Health monitoring before posting
- Batch posting with rate limiting
- Error classification (transient vs permanent)

Always-on features:
- pre_tool_call hook: validate connection before sm_* calls
- Post-execution logging: auto-log events to analytics
"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

from plugins.social_media_poster.tools import (
    SM_POST_SCHEMA,
    SM_COMMENT_SCHEMA,
    SM_BATCH_POST_SCHEMA,
    SM_HEALTH_SCHEMA,
    _handle_sm_post,
    _handle_sm_comment,
    _handle_sm_batch_post,
    _handle_sm_health,
)

_TOOLS = (
    ("sm_post",       SM_POST_SCHEMA,       _handle_sm_post,       "📝"),
    ("sm_comment",    SM_COMMENT_SCHEMA,    _handle_sm_comment,    "💬"),
    ("sm_batch_post", SM_BATCH_POST_SCHEMA, _handle_sm_batch_post, "📦"),
    ("sm_health",     SM_HEALTH_SCHEMA,     _handle_sm_health,     "🏥"),
)


def _pre_tool_call_hook(tool_name: str, tool_args: dict, **kwargs) -> dict | None:
    """Hook before sm_* tool calls — ensure Chrome is ready."""
    if not tool_name.startswith("sm_"):
        return None

    platform = tool_args.get("platform")
    if not platform:
        return None

    from plugins.chrome_connector.manager import get_manager
    manager = get_manager()

    health = manager.check_health(platform)
    if not health.get("cdp_ready"):
        logger.info(f"[social_media_poster] Pre-hook: restarting {platform}")
        try:
            manager.stop(platform)
            time.sleep(1)
            manager.start(platform, headless=True)
            time.sleep(3)
        except Exception as e:
            logger.warning(f"[social_media_poster] Pre-hook restart failed: {e}")

    return None


def _post_tool_call_hook(tool_name: str, tool_args: dict, result: str, **kwargs) -> None:
    """Hook after sm_* tool calls — log to analytics if available."""
    if not tool_name.startswith("sm_"):
        return

    try:
        import json
        from plugins.campaign_analytics.tools import _get_db
        from datetime import datetime

        db = _get_db()
        db.execute("""
            INSERT INTO events (timestamp, event_type, platform, content, metadata)
            VALUES (?, ?, ?, ?, ?)
        """, (
            datetime.utcnow().isoformat(),
            "post" if tool_name == "sm_post" else "comment",
            tool_args.get("platform"),
            tool_args.get("text", "")[:500],
            json.dumps({"tool": tool_name, "args": tool_args}),
        ))
        db.commit()
        db.close()
    except Exception:
        pass  # Analytics not available, skip


def register(ctx) -> None:
    """Register all Social Media Poster tools and hooks."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="social_media_poster",
            schema=schema,
            handler=handler,
            emoji=emoji,
        )

    # Register hooks
    ctx.register_hook("pre_tool_call", _pre_tool_call_hook)
    ctx.register_hook("post_tool_call", _post_tool_call_hook)
