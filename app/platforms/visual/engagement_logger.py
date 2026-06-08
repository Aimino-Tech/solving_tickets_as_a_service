"""Engagement logger for visual content platform actions (SQLite-backed)."""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

DUCKDB_PATH = os.getenv("VISUAL_CONTENT_DB", str(Path(__file__).parent.parent.parent / "workspace" / "visual-content" / "visual_content.db"))


def _get_conn():
    os.makedirs(os.path.dirname(DUCKDB_PATH), exist_ok=True)
    conn = sqlite3.connect(DUCKDB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS visual_engagements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform VARCHAR NOT NULL,
            action VARCHAR NOT NULL,
            status VARCHAR NOT NULL DEFAULT 'pending',
            media_type VARCHAR,
            media_url TEXT,
            platform_post_id VARCHAR,
            platform_post_url TEXT,
            content_preview VARCHAR(500),
            metadata TEXT,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS visual_content_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title VARCHAR NOT NULL,
            description TEXT,
            media_path TEXT NOT NULL,
            media_type VARCHAR NOT NULL,
            target_platforms TEXT NOT NULL,
            status VARCHAR DEFAULT 'pending',
            cross_post_id VARCHAR,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ve_platform ON visual_engagements(platform)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ve_status ON visual_engagements(status)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_vcq_status ON visual_content_queue(status)
    """)
    conn.commit()
    return conn


def log_event(
    platform: str,
    action: str,
    status: str,
    media_type: Optional[str] = None,
    media_url: Optional[str] = None,
    platform_post_id: Optional[str] = None,
    platform_post_url: Optional[str] = None,
    content_preview: Optional[str] = None,
    metadata: Optional[dict] = None,
    error_message: Optional[str] = None,
) -> int:
    conn = _get_conn()
    try:
        cursor = conn.execute(
            """INSERT INTO visual_engagements
               (platform, action, status, media_type, media_url,
                platform_post_id, platform_post_url, content_preview,
                metadata, error_message)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                platform, action, status, media_type, media_url,
                platform_post_id, platform_post_url,
                (content_preview or "")[:500],
                json.dumps(metadata or {}),
                error_message,
            ),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


ALLOWED_COLUMNS = frozenset({
    "status", "platform", "action", "media_type", "media_url",
    "platform_post_id", "platform_post_url", "content_preview",
    "metadata", "error_message",
})


def update_event(event_id: int, status: str, **kwargs: Any) -> None:
    conn = _get_conn()
    try:
        fields = ["status = ?", "updated_at = ?"]
        values = [status, datetime.now(timezone.utc).isoformat()]
        for key, val in kwargs.items():
            if key not in ALLOWED_COLUMNS:
                continue
            if val is not None:
                fields.append(f"{key} = ?")
                values.append(val)
        values.append(event_id)
        conn.execute(
            f"UPDATE visual_engagements SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        conn.commit()
    finally:
        conn.close()


def queue_content(
    title: str,
    media_path: str,
    media_type: str,
    target_platforms: list[str],
    description: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> int:
    conn = _get_conn()
    try:
        cursor = conn.execute(
            """INSERT INTO visual_content_queue
               (title, description, media_path, media_type, target_platforms, metadata)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                title, description, media_path, media_type,
                json.dumps(target_platforms), json.dumps(metadata or {}),
            ),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def get_pending_queue() -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM visual_content_queue WHERE status = 'pending' ORDER BY created_at ASC"
        ).fetchall()
        columns = [desc[0] for desc in conn.description]
        return [dict(zip(columns, row)) for row in rows]
    finally:
        conn.close()


def mark_queue_done(queue_id: int, cross_post_id: str, status: str = "completed") -> None:
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE visual_content_queue SET status = ?, cross_post_id = ?, updated_at = ? WHERE id = ?",
            (status, cross_post_id, datetime.now(timezone.utc).isoformat(), queue_id),
        )
        conn.commit()
    finally:
        conn.close()
