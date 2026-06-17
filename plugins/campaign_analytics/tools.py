"""Campaign Analytics tools — track metrics and ROI."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from tools.registry import tool_error, tool_result


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------

DB_PATH = Path(os.environ.get("HERMES_HOME", "~/.hermes")) / "analytics.db"


def _get_db() -> sqlite3.Connection:
    """Get or create analytics database."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Create tables if not exist
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            platform TEXT,
            campaign TEXT,
            content TEXT,
            url TEXT,
            metadata TEXT,
            cost_tokens INTEGER DEFAULT 0,
            cost_usd REAL DEFAULT 0.0
        );

        CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            started TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            target_platforms TEXT,
            notes TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_events_platform ON events(platform);
        CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign);
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Tool Schemas
# ---------------------------------------------------------------------------

ANALYTICS_LOG_SCHEMA = {
    "name": "analytics_log",
    "description": "Log a marketing event (post, comment, reply, engagement) to the analytics database.",
    "parameters": {
        "type": "object",
        "properties": {
            "event_type": {
                "type": "string",
                "enum": ["post", "comment", "reply", "upvote", "click", "signup", "cost"],
                "description": "Type of event to log",
            },
            "platform": {
                "type": "string",
                "description": "Platform where event occurred (twitter, linkedin, reddit, etc.)",
            },
            "campaign": {
                "type": "string",
                "description": "Campaign name this event belongs to",
            },
            "content": {
                "type": "string",
                "description": "Content or summary of the event",
            },
            "url": {
                "type": "string",
                "description": "URL of the post/comment if applicable",
            },
            "metadata": {
                "type": "object",
                "description": "Additional metadata (score, likes, etc.)",
            },
            "cost_tokens": {
                "type": "integer",
                "description": "Tokens used for this event (for cost tracking)",
            },
            "cost_usd": {
                "type": "number",
                "description": "USD cost for this event",
            },
        },
        "required": ["event_type"],
    },
}

ANALYTICS_REPORT_SCHEMA = {
    "name": "analytics_report",
    "description": "Generate analytics report for a campaign or time period.",
    "parameters": {
        "type": "object",
        "properties": {
            "campaign": {
                "type": "string",
                "description": "Campaign name to report on",
            },
            "platform": {
                "type": "string",
                "description": "Filter by platform",
            },
            "days": {
                "type": "integer",
                "description": "Number of days to look back (default: 7)",
            },
            "event_type": {
                "type": "string",
                "description": "Filter by event type",
            },
        },
        "required": [],
    },
}

ANALYTICS_DASHBOARD_SCHEMA = {
    "name": "analytics_dashboard",
    "description": "Get dashboard summary with key metrics and trends.",
    "parameters": {
        "type": "object",
        "properties": {
            "days": {
                "type": "integer",
                "description": "Number of days for dashboard (default: 30)",
            },
        },
        "required": [],
    },
}


# ---------------------------------------------------------------------------
# Tool Handlers
# ---------------------------------------------------------------------------

def _handle_analytics_log(args: dict, **kw) -> str:
    event_type = args.get("event_type", "")
    if not event_type:
        return tool_error("event_type is required")

    db = _get_db()
    try:
        db.execute("""
            INSERT INTO events (timestamp, event_type, platform, campaign, content, url, metadata, cost_tokens, cost_usd)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            datetime.utcnow().isoformat(),
            event_type,
            args.get("platform"),
            args.get("campaign"),
            args.get("content"),
            args.get("url"),
            json.dumps(args.get("metadata", {})),
            args.get("cost_tokens", 0),
            args.get("cost_usd", 0.0),
        ))
        db.commit()

        return tool_result({
            "success": True,
            "event_type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        return tool_error(f"Failed to log event: {e}")
    finally:
        db.close()


def _handle_analytics_report(args: dict, **kw) -> str:
    db = _get_db()
    try:
        days = args.get("days", 7)
        campaign = args.get("campaign")
        platform = args.get("platform")
        event_type = args.get("event_type")

        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

        query = "SELECT * FROM events WHERE timestamp > ?"
        params = [cutoff]

        if campaign:
            query += " AND campaign = ?"
            params.append(campaign)
        if platform:
            query += " AND platform = ?"
            params.append(platform)
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)

        query += " ORDER BY timestamp DESC"

        rows = db.execute(query, params).fetchall()

        # Aggregate stats
        stats = {
            "total_events": len(rows),
            "by_type": {},
            "by_platform": {},
            "total_cost_usd": 0.0,
            "total_cost_tokens": 0,
        }

        for row in rows:
            et = row["event_type"]
            plat = row["platform"] or "unknown"

            stats["by_type"][et] = stats["by_type"].get(et, 0) + 1
            stats["by_platform"][plat] = stats["by_platform"].get(plat, 0) + 1
            stats["total_cost_usd"] += row["cost_usd"] or 0
            stats["total_cost_tokens"] += row["cost_tokens"] or 0

        # Recent events
        recent = []
        for row in rows[:20]:
            recent.append({
                "timestamp": row["timestamp"],
                "event_type": row["event_type"],
                "platform": row["platform"],
                "campaign": row["campaign"],
                "content": row["content"][:100] if row["content"] else None,
                "url": row["url"],
            })

        return tool_result({
            "period_days": days,
            "campaign_filter": campaign,
            "stats": stats,
            "recent_events": recent,
        })
    except Exception as e:
        return tool_error(f"Failed to generate report: {e}")
    finally:
        db.close()


def _handle_analytics_dashboard(args: dict, **kw) -> str:
    db = _get_db()
    try:
        days = args.get("days", 30)
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

        # Get all events in period
        rows = db.execute(
            "SELECT * FROM events WHERE timestamp > ? ORDER BY timestamp",
            [cutoff]
        ).fetchall()

        # Calculate daily trends
        daily = {}
        for row in rows:
            day = row["timestamp"][:10]
            if day not in daily:
                daily[day] = {"posts": 0, "comments": 0, "engagement": 0, "cost": 0.0}

            et = row["event_type"]
            if et in ("post",):
                daily[day]["posts"] += 1
            elif et in ("comment", "reply"):
                daily[day]["comments"] += 1
            elif et in ("upvote", "click", "signup"):
                daily[day]["engagement"] += 1
            daily[day]["cost"] += row["cost_usd"] or 0

        # Platform breakdown
        platforms = {}
        for row in rows:
            plat = row["platform"] or "unknown"
            if plat not in platforms:
                platforms[plat] = {"posts": 0, "comments": 0, "engagement": 0}
            et = row["event_type"]
            if et == "post":
                platforms[plat]["posts"] += 1
            elif et in ("comment", "reply"):
                platforms[plat]["comments"] += 1
            elif et in ("upvote", "click", "signup"):
                platforms[plat]["engagement"] += 1

        # Campaign breakdown
        campaigns = {}
        for row in rows:
            camp = row["campaign"] or "uncategorized"
            if camp not in campaigns:
                campaigns[camp] = {"events": 0, "cost": 0.0}
            campaigns[camp]["events"] += 1
            campaigns[camp]["cost"] += row["cost_usd"] or 0

        # Totals
        total_posts = sum(1 for r in rows if r["event_type"] == "post")
        total_comments = sum(1 for r in rows if r["event_type"] in ("comment", "reply"))
        total_engagement = sum(1 for r in rows if r["event_type"] in ("upvote", "click", "signup"))
        total_cost = sum(r["cost_usd"] or 0 for r in rows)
        total_tokens = sum(r["cost_tokens"] or 0 for r in rows)

        return tool_result({
            "period_days": days,
            "summary": {
                "total_posts": total_posts,
                "total_comments": total_comments,
                "total_engagement": total_engagement,
                "total_cost_usd": round(total_cost, 4),
                "total_tokens": total_tokens,
            },
            "daily_trends": daily,
            "platform_breakdown": platforms,
            "campaign_breakdown": campaigns,
        })
    except Exception as e:
        return tool_error(f"Failed to generate dashboard: {e}")
    finally:
        db.close()
