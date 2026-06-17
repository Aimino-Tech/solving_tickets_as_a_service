"""Campaign Analytics plugin — track metrics and ROI.

Features:
- Log posts, comments, engagements to SQLite
- Track agent costs (tokens, API calls)
- Generate reports (daily, weekly, per-campaign)
- Optional Langfuse integration for dashboards
- Google Sheets sync for marketing tracking

Always-on features:
- Auto-logging: tracks all tool calls and costs
- Daily rollup: aggregates metrics every 24h
- Cost tracking: monitors token usage and API costs
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

from plugins.campaign_analytics.tools import (
    ANALYTICS_LOG_SCHEMA,
    ANALYTICS_REPORT_SCHEMA,
    ANALYTICS_DASHBOARD_SCHEMA,
    _handle_analytics_log,
    _handle_analytics_report,
    _handle_analytics_dashboard,
    _get_db,
)

_TOOLS = (
    ("analytics_log",       ANALYTICS_LOG_SCHEMA,       _handle_analytics_log,       "📝"),
    ("analytics_report",    ANALYTICS_REPORT_SCHEMA,    _handle_analytics_report,    "📊"),
    ("analytics_dashboard", ANALYTICS_DASHBOARD_SCHEMA, _handle_analytics_dashboard, "🖥️"),
)

# Background rollup state
_rollup_thread: threading.Thread | None = None
_rollup_stop = threading.Event()
ROLLUP_INTERVAL = 86400  # 24 hours


def _daily_rollup():
    """Background thread that aggregates daily metrics."""
    logger.info("[campaign_analytics] Daily rollup started")

    while not _rollup_stop.is_set():
        try:
            db = _get_db()
            today = datetime.utcnow().strftime("%Y-%m-%d")

            # Check if rollup already exists
            existing = db.execute(
                "SELECT id FROM daily_rollups WHERE date = ?", (today,)
            ).fetchone()

            if not existing:
                # Calculate rollup
                cutoff = (datetime.utcnow() - timedelta(days=1)).isoformat()
                rows = db.execute(
                    "SELECT * FROM events WHERE timestamp > ?", (cutoff,)
                ).fetchall()

                stats = {
                    "posts": sum(1 for r in rows if r["event_type"] == "post"),
                    "comments": sum(1 for r in rows if r["event_type"] in ("comment", "reply")),
                    "engagement": sum(1 for r in rows if r["event_type"] in ("upvote", "click", "signup")),
                    "cost_usd": sum(r["cost_usd"] or 0 for r in rows),
                    "cost_tokens": sum(r["cost_tokens"] or 0 for r in rows),
                }

                db.execute("""
                    INSERT INTO daily_rollups (date, stats, created_at)
                    VALUES (?, ?, ?)
                """, (today, json.dumps(stats), datetime.utcnow().isoformat()))
                db.commit()
                logger.info(f"[campaign_analytics] Daily rollup for {today}: {stats}")

            db.close()
        except Exception as e:
            logger.warning(f"[campaign_analytics] Rollup error: {e}")

        _rollup_stop.wait(ROLLUP_INTERVAL)

    logger.info("[campaign_analytics] Daily rollup stopped")


def _post_tool_call_hook(tool_name: str, tool_args: dict, result: str, **kwargs) -> None:
    """Hook after tool calls — auto-log to analytics."""
    try:
        from plugins.campaign_analytics.tools import _get_db
        from datetime import datetime

        db = _get_db()

        # Log the tool call
        db.execute("""
            INSERT INTO events (timestamp, event_type, platform, content, metadata)
            VALUES (?, ?, ?, ?, ?)
        """, (
            datetime.utcnow().isoformat(),
            "tool_call",
            None,
            f"{tool_name}: {json.dumps(tool_args)[:500]}",
            json.dumps({"tool": tool_name, "result_preview": result[:200] if result else ""}),
        ))
        db.commit()
        db.close()
    except Exception:
        pass


def register(ctx) -> None:
    """Register all Campaign Analytics tools and hooks."""
    # Ensure rollup table exists
    try:
        db = _get_db()
        db.execute("""
            CREATE TABLE IF NOT EXISTS daily_rollups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                stats TEXT,
                created_at TEXT NOT NULL
            )
        """)
        db.commit()
        db.close()
    except Exception:
        pass

    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="campaign_analytics",
            schema=schema,
            handler=handler,
            emoji=emoji,
        )

    # Register hooks
    ctx.register_hook("post_tool_call", _post_tool_call_hook)

    # Start daily rollup
    global _rollup_thread
    if _rollup_thread is None or not _rollup_thread.is_alive():
        _rollup_stop.clear()
        _rollup_thread = threading.Thread(target=_daily_rollup, daemon=True)
        _rollup_thread.start()
        logger.info("[campaign_analytics] Daily rollup started")
