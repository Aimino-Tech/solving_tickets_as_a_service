"""DuckDB analytics store for marketing ROI data.

Stored at ``<get_hermes_home()>/marketing/marketing.db``.
Thread-safe. Uses duckdb (Apache-2.0, embedded analytics DB).

Time-series, aggregations, and window functions for Grafana dashboards.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)

_DB_RELATIVE_PATH = "marketing/marketing.db"

# ── Schema DDL ──────────────────────────────────────────────────────────────

_SCHEMA_SQL = """
CREATE SEQUENCE IF NOT EXISTS raw_events_seq START 1;
CREATE TABLE IF NOT EXISTS raw_events (
    id          INTEGER PRIMARY KEY DEFAULT nextval('raw_events_seq'),
    platform    TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    content     TEXT,
    author      TEXT,
    url         TEXT,
    score       INTEGER DEFAULT 0,
    metadata    TEXT DEFAULT '{}',
    campaign_name TEXT DEFAULT '',
    occurred_at TEXT NOT NULL,
    collected_at TEXT NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS github_traffic_seq START 1;
CREATE TABLE IF NOT EXISTS github_traffic (
    id              INTEGER PRIMARY KEY DEFAULT nextval('github_traffic_seq'),
    repo            TEXT NOT NULL,
    collected_at    TEXT NOT NULL,
    clones_unique   INTEGER DEFAULT 0,
    clones_count    INTEGER DEFAULT 0,
    views_unique    INTEGER DEFAULT 0,
    views_count     INTEGER DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS github_referrers_seq START 1;
CREATE TABLE IF NOT EXISTS github_referrers (
    id              INTEGER PRIMARY KEY DEFAULT nextval('github_referrers_seq'),
    repo            TEXT NOT NULL,
    collected_at    TEXT NOT NULL,
    referrer        TEXT NOT NULL,
    count           INTEGER DEFAULT 0,
    uniques         INTEGER DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS npm_downloads_seq START 1;
CREATE TABLE IF NOT EXISTS npm_downloads (
    id                  INTEGER PRIMARY KEY DEFAULT nextval('npm_downloads_seq'),
    package             TEXT NOT NULL,
    collected_at        TEXT NOT NULL,
    downloads_last_day  INTEGER DEFAULT 0,
    downloads_last_week INTEGER DEFAULT 0,
    downloads_last_month INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sentiment_scores (
    raw_event_id INTEGER PRIMARY KEY,
    compound REAL NOT NULL,
    positive REAL NOT NULL DEFAULT 0,
    neutral REAL NOT NULL DEFAULT 0,
    negative REAL NOT NULL DEFAULT 0,
    scored_at TEXT NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS costs_seq START 1;
CREATE TABLE IF NOT EXISTS costs (
    id          INTEGER PRIMARY KEY DEFAULT nextval('costs_seq'),
    campaign_id TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT '',
    action_type TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL,
    hours       REAL DEFAULT 0,
    hourly_rate REAL DEFAULT 0,
    total_cost  REAL DEFAULT 0,
    notes       TEXT DEFAULT '',
    sheet_row   INTEGER DEFAULT 0,
    synced_at   TEXT NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS sheet_import_log_seq START 1;
CREATE TABLE IF NOT EXISTS sheet_import_log (
    id          INTEGER PRIMARY KEY DEFAULT nextval('sheet_import_log_seq'),
    tab_name    TEXT NOT NULL,
    row_number  INTEGER NOT NULL,
    content_id  TEXT DEFAULT '',
    imported_at TEXT NOT NULL,
    UNIQUE(tab_name, row_number)
);
"""

_DAILY_AGGREGATES_SQL = """
CREATE OR REPLACE VIEW daily_aggregates AS
SELECT
    DATE(r.occurred_at) as day,
    r.platform,
    r.event_type,
    COUNT(*) as event_count,
    COALESCE(SUM(r.score), 0) as total_score,
    COALESCE(AVG(s.compound), 0) as avg_sentiment,
    COUNT(DISTINCT r.author) as unique_authors
FROM raw_events r
LEFT JOIN sentiment_scores s ON r.id = s.raw_event_id
GROUP BY day, r.platform, r.event_type;
"""


class DuckDBStore:
    """Analytics store backed by DuckDB.

    Stores: raw_events, sentiment_scores, github_traffic, npm_downloads,
    costs, sheet_import_log. Provides query helpers for dashboard consumption.
    """

    def __init__(self, db_path: str | Path | None = None):
        if db_path is None:
            db_path = get_hermes_home() / _DB_RELATIVE_PATH
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn: duckdb.DuckDBPyConnection | None = None
        self._init_db()

    def _get_conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            self._conn = duckdb.connect(str(self._db_path))
        return self._conn

    def _init_db(self):
        with self._lock:
            conn = self._get_conn()
            for stmt in _SCHEMA_SQL.split(";"):
                s = stmt.strip()
                if s:
                    try:
                        conn.execute(s)
                    except Exception:
                        pass  # idempotent schema creation
            # Create views
            try:
                conn.execute(_DAILY_AGGREGATES_SQL)
            except Exception:
                pass

    def insert_raw_events(self, events: list[dict]) -> int:
        """Insert raw events, returns count inserted."""
        with self._lock:
            conn = self._get_conn()
            now = datetime.now(timezone.utc).isoformat()
            count = 0
            for ev in events:
                try:
                    conn.execute(
                        """INSERT INTO raw_events
                           (platform, source_id, event_type, content, author,
                            url, score, metadata, campaign_name,
                            occurred_at, collected_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        [
                            ev.get("platform", "other"),
                            ev.get("source_id", ""),
                            ev.get("event_type", "post"),
                            ev.get("content", ""),
                            ev.get("author", ""),
                            ev.get("url", ""),
                            ev.get("score", 0),
                            json.dumps(ev.get("metadata", {})),
                            ev.get("campaign_name", ""),
                            ev.get("occurred_at", now),
                            now,
                        ],
                    )
                    count += 1
                except Exception as e:
                    logger.warning("Failed to insert event: %s", e)
            return count

    def insert_github_traffic(self, rows: list[dict]) -> int:
        """Insert GitHub traffic data."""
        with self._lock:
            conn = self._get_conn()
            now = datetime.now(timezone.utc).isoformat()
            count = 0
            for row in rows:
                try:
                    conn.execute(
                        """INSERT INTO github_traffic
                           (repo, collected_at, clones_unique, clones_count,
                            views_unique, views_count)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        [
                            row.get("repo", ""),
                            now,
                            row.get("clones_unique", 0),
                            row.get("clones_count", 0),
                            row.get("views_unique", 0),
                            row.get("views_count", 0),
                        ],
                    )
                    count += 1
                except Exception as e:
                    logger.warning("Failed to insert github traffic: %s", e)
            return count

    def insert_npm_downloads(self, rows: list[dict]) -> int:
        """Insert npm download data."""
        with self._lock:
            conn = self._get_conn()
            now = datetime.now(timezone.utc).isoformat()
            count = 0
            for row in rows:
                try:
                    conn.execute(
                        """INSERT INTO npm_downloads
                           (package, collected_at,
                            downloads_last_day, downloads_last_week,
                            downloads_last_month)
                           VALUES (?, ?, ?, ?, ?)""",
                        [
                            row.get("package", ""),
                            now,
                            row.get("downloads_last_day", 0),
                            row.get("downloads_last_week", 0),
                            row.get("downloads_last_month", 0),
                        ],
                    )
                    count += 1
                except Exception as e:
                    logger.warning("Failed to insert npm downloads: %s", e)
            return count

    def insert_sentiment_scores(self, scores: list[dict]) -> int:
        """Insert sentiment scores. Must include raw_event_id key."""
        with self._lock:
            conn = self._get_conn()
            now = datetime.now(timezone.utc).isoformat()
            count = 0
            for s in scores:
                try:
                    conn.execute(
                        """INSERT OR REPLACE INTO sentiment_scores
                           (raw_event_id, compound, positive, neutral,
                            negative, scored_at)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        [
                            s["raw_event_id"],
                            s.get("compound", 0.0),
                            s.get("positive", 0.0),
                            s.get("neutral", 0.0),
                            s.get("negative", 0.0),
                            now,
                        ],
                    )
                    count += 1
                except Exception as e:
                    logger.warning("Failed to insert sentiment: %s", e)
            return count

    def insert_costs(self, costs: list[dict]) -> int:
        """Insert cost entries from Google Sheets."""
        with self._lock:
            conn = self._get_conn()
            now = datetime.now(timezone.utc).isoformat()
            count = 0
            for c in costs:
                hours = float(c.get("hours", 0))
                rate = float(c.get("hourly_rate", 0))
                total_cost = hours * rate
                try:
                    conn.execute(
                        """INSERT INTO costs
                           (campaign_id, platform, action_type, date,
                            hours, hourly_rate, total_cost, notes,
                            sheet_row, synced_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        [
                            c.get("campaign_id", ""),
                            c.get("platform", ""),
                            c.get("action_type", ""),
                            c.get("date", ""),
                            hours,
                            rate,
                            total_cost,
                            c.get("notes", ""),
                            c.get("sheet_row", 0),
                            now,
                        ],
                    )
                    count += 1
                except Exception as e:
                    logger.warning("Failed to insert cost: %s", e)
            return count

    # ── Query helpers for Grafana ──────────────────────────────────────────

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        """Execute arbitrary SQL, return list of dicts. Safe for Grafana."""
        with self._lock:
            conn = self._get_conn()
            result = conn.execute(sql, params or [])
            columns = [desc[0] for desc in result.description]
            return [dict(zip(columns, row)) for row in result.fetchall()]

    def query_daily_aggregates(self, days: int = 30) -> list[dict]:
        """Return daily aggregate rows for the last *days*."""
        return self.query(
            """SELECT day, platform, event_type, event_count,
                      total_score, avg_sentiment
               FROM daily_aggregates
               WHERE day >= CURRENT_DATE - (? * INTERVAL '1 day')
               ORDER BY day""",
            [days],
        )

    def query_raw_events(
        self,
        platform: str | None = None,
        since: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """Query raw events with optional platform/time filters."""
        sql = "SELECT * FROM raw_events"
        where = []
        params: list[Any] = []
        if platform:
            where.append("platform = ?")
            params.append(platform)
        if since:
            where.append("occurred_at >= ?")
            params.append(since)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY occurred_at DESC LIMIT ?"
        params.append(limit)
        return self.query(sql, params)

    def close(self):
        """Close the DuckDB connection."""
        if self._conn:
            self._conn.close()
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
