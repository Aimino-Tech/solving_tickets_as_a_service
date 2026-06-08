"""DuckDB schema and helpers for engagement tracking."""

import os
import json
import uuid
from datetime import datetime, timezone

import duckdb
from app.tracking import tracker


def _db_path():
    return os.getenv("OPENCLAW_MARKETING_DB", "openclaw_marketing.duckdb")


def get_connection():
    con = duckdb.connect(_db_path())
    _ensure_schema(con)
    return con


def _ensure_schema(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS engagements (
            id VARCHAR PRIMARY KEY,
            platform VARCHAR NOT NULL,
            external_id VARCHAR,
            action VARCHAR NOT NULL,
            content TEXT,
            status VARCHAR DEFAULT 'pending',
            approval VARCHAR DEFAULT 'auto',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            responded_at TIMESTAMP,
            metadata JSON
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id VARCHAR PRIMARY KEY,
            platform VARCHAR NOT NULL,
            username VARCHAR,
            engagement_id VARCHAR,
            score INTEGER DEFAULT 0,
            contacted BOOLEAN DEFAULT FALSE,
            notes TEXT
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS tokens (
            id INTEGER PRIMARY KEY,
            platform VARCHAR NOT NULL,
            token_type VARCHAR NOT NULL,
            expires_at TIMESTAMP,
            last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            credential_hash VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS orchestrator_state (
            key VARCHAR PRIMARY KEY,
            value JSON,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_engagements_platform ON engagements(platform)",
        "CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status)",
        "CREATE INDEX IF NOT EXISTS idx_engagements_created ON engagements(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(platform)",
        "CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score)",
    ]:
        con.execute(idx)


def log_engagement(platform, external_id, action, content, metadata=None, approval="auto"):
    con = get_connection()
    try:
        eid = str(uuid.uuid4())
        con.execute(
            "INSERT INTO engagements (id, platform, external_id, action, content, approval, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [eid, platform, external_id, action, content, approval, json.dumps(metadata or {})],
        )
        tracker.track_engagement(platform, action, content_preview=content[:200] if content else None, score=0, status=approval)
        return eid
    finally:
        con.close()


def log_lead(platform, username, engagement_id, score=0, notes=None):
    con = get_connection()
    try:
        lid = str(uuid.uuid4())
        con.execute(
            "INSERT INTO leads (id, platform, username, engagement_id, score, notes) VALUES (?, ?, ?, ?, ?, ?)",
            [lid, platform, username, engagement_id, score, notes],
        )
        tracker.track_lead(platform, author_name=username, relevance_score=score)
        return lid
    finally:
        con.close()


def update_engagement_status(engagement_id, status):
    con = get_connection()
    try:
        con.execute(
            "UPDATE engagements SET status = ?, responded_at = ? WHERE id = ?",
            [status, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), engagement_id],
        )
    finally:
        con.close()


def get_pending_engagements(platform=None):
    con = get_connection()
    try:
        if platform:
            return con.execute(
                "SELECT * FROM engagements WHERE status = 'pending' AND platform = ? ORDER BY created_at DESC",
                [platform],
            ).fetchdf()
        return con.execute(
            "SELECT * FROM engagements WHERE status = 'pending' ORDER BY created_at DESC"
        ).fetchdf()
    finally:
        con.close()


def get_recent_engagements(limit=20):
    con = get_connection()
    try:
        return con.execute(
            "SELECT * FROM engagements ORDER BY created_at DESC LIMIT ?", [limit]
        ).fetchdf()
    finally:
        con.close()


def get_state(key):
    con = get_connection()
    try:
        row = con.execute(
            "SELECT value FROM orchestrator_state WHERE key = ?", [key]
        ).fetchone()
        return json.loads(row[0]) if row else None
    finally:
        con.close()


def set_state(key, value):
    con = get_connection()
    try:
        con.execute(
            "INSERT OR REPLACE INTO orchestrator_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            [key, json.dumps(value)],
        )
    finally:
        con.close()
