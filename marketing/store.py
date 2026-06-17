"""Marketing campaign data store — SQLite-backed persistent store.

Thread-safe. Uses stdlib ``sqlite3`` only — no external dependencies.
Database is auto-created at ``<HERMES_HOME>/marketing/campaigns.db``.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from hermes_constants import get_hermes_home
from marketing.roi_arch import SCHEMA_EXTENSIONS_SQL

logger = logging.getLogger(__name__)

# Default database location relative to Hermes home
DB_RELATIVE_PATH = "marketing/campaigns.db"

# ── Schema DDL ──────────────────────────────────────────────────────────────

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    product     TEXT NOT NULL DEFAULT '',
    start_date  TEXT NOT NULL DEFAULT '',
    end_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'draft',
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    timestamp       TEXT NOT NULL,
    platform        TEXT NOT NULL,
    action_type     TEXT NOT NULL,
    target_url      TEXT,
    content_preview TEXT,
    score           REAL,
    status          TEXT NOT NULL DEFAULT 'pending',
    profile_name    TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    name            TEXT PRIMARY KEY,
    platform        TEXT NOT NULL,
    profile_name    TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    warmup_start    TEXT,
    warmup_phase    TEXT,
    karma           REAL NOT NULL DEFAULT 0.0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    collected_at    TEXT NOT NULL,
    github_stars    INTEGER NOT NULL DEFAULT 0,
    npm_downloads   INTEGER NOT NULL DEFAULT 0,
    x_mentions      INTEGER NOT NULL DEFAULT 0,
    sheet_row_count INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_campaign
    ON actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_actions_platform
    ON actions(platform);
CREATE INDEX IF NOT EXISTS idx_metrics_campaign
    ON metrics(campaign_id);

CREATE TABLE IF NOT EXISTS cron_job_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name        TEXT NOT NULL,
    job_type        TEXT NOT NULL,
    platform        TEXT,
    status          TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    duration_ms     INTEGER,
    result_summary  TEXT,
    error_message   TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_job_date
    ON cron_job_log(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_job_status
    ON cron_job_log(status);
"""


def _now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _dict_from_row(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a ``sqlite3.Row`` to a plain dict."""
    return dict(row)


# ── CampaignStore ───────────────────────────────────────────────────────────


class CampaignStore:
    """SQLite-backed persistent store for marketing campaigns.

    Creates the database and schema on first instantiation.
    All public methods are thread-safe.
    """

    def __init__(self, db_path: str | None = None) -> None:
        """Open (or create) the database at *db_path*.

        If *db_path* is ``None`` the default path
        ``<HERMES_HOME>/marketing/campaigns.db`` is used.
        """
        if db_path is None:
            hermes_home = get_hermes_home()
            hermes_home.mkdir(parents=True, exist_ok=True)
            marketing_dir = hermes_home / "marketing"
            marketing_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(marketing_dir / "campaigns.db")

        self._db_path = db_path
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None

        self._initialize()

    # ── internal helpers ──────────────────────────────────────────────────

    def _initialize(self) -> None:
        """Open the database connection and create tables if needed."""
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(_SCHEMA_SQL)
        conn.executescript(SCHEMA_EXTENSIONS_SQL)
        conn.commit()
        self._conn = conn

    @property
    def conn(self) -> sqlite3.Connection:
        """Return the underlying connection (lazy init safe)."""
        if self._conn is None:
            self._initialize()
        return self._conn  # type: ignore[return-value]

    def _execute(
        self,
        sql: str,
        params: tuple[Any, ...] = (),
        *,
        commit: bool = False,
    ) -> sqlite3.Cursor:
        """Execute a query under the thread lock."""
        with self._lock:
            cur = self.conn.execute(sql, params)
            if commit:
                self.conn.commit()
            return cur

    def _fetchone(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        """Fetch a single row as a dict."""
        with self._lock:
            cur = self.conn.execute(sql, params)
            row = cur.fetchone()
            return _dict_from_row(row) if row else None

    def _fetchall(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        """Fetch all rows as a list of dicts."""
        with self._lock:
            cur = self.conn.execute(sql, params)
            return [_dict_from_row(r) for r in cur.fetchall()]

    # ── campaigns ─────────────────────────────────────────────────────────

    def create_campaign(self, config_dict: dict[str, Any]) -> str:
        """Persist a new campaign from *config_dict*.

        Returns the auto-generated campaign ID.
        """
        campaign_id = str(uuid.uuid4())[:8]
        now = _now()
        config_json = json.dumps(config_dict, ensure_ascii=False, default=str)

        self._execute(
            """INSERT INTO campaigns
               (id, name, product, start_date, end_date, status,
                config_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                campaign_id,
                config_dict.get("name", ""),
                config_dict.get("product", ""),
                config_dict.get("start_date", ""),
                config_dict.get("end_date"),
                "draft",
                config_json,
                now,
                now,
            ),
            commit=True,
        )
        logger.info("Created campaign %s (%s)", campaign_id, config_dict.get("name", ""))
        return campaign_id

    def get_campaign(self, campaign_id: str) -> dict[str, Any] | None:
        """Return a campaign dict or ``None`` if not found."""
        return self._fetchone("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))

    def list_campaigns(self, status: str | None = None) -> list[dict[str, Any]]:
        """List all campaigns, optionally filtered by *status*."""
        if status:
            return self._fetchall(
                "SELECT * FROM campaigns WHERE status = ? ORDER BY created_at DESC",
                (status,),
            )
        return self._fetchall("SELECT * FROM campaigns ORDER BY created_at DESC")

    def update_campaign_status(self, campaign_id: str, status: str) -> None:
        """Update the status of a campaign."""
        now = _now()
        self._execute(
            "UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, campaign_id),
            commit=True,
        )

    def delete_campaign(self, campaign_id: str) -> None:
        """Delete a campaign and all its actions/metrics (CASCADE)."""
        self._execute(
            "DELETE FROM campaigns WHERE id = ?",
            (campaign_id,),
            commit=True,
        )

    # ── actions ───────────────────────────────────────────────────────────

    def log_action(
        self,
        campaign_id: str,
        platform: str,
        action_type: str,
        **kwargs: Any,
    ) -> int:
        """Record a campaign action.

        Returns the auto-incremented action ID.

        Keyword args
        ------------
        target_url : str, optional
        content_preview : str, optional
        score : float, optional
        status : str, optional  (default ``"pending"``)
        profile_name : str, optional
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO actions
               (campaign_id, timestamp, platform, action_type,
                target_url, content_preview, score, status,
                profile_name, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                campaign_id,
                kwargs.get("timestamp", now),
                platform,
                action_type,
                kwargs.get("target_url"),
                kwargs.get("content_preview"),
                kwargs.get("score"),
                kwargs.get("status", "pending"),
                kwargs.get("profile_name"),
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_actions(
        self,
        campaign_id: str,
        since: str | None = None,
        platform: str | None = None,
    ) -> list[dict[str, Any]]:
        """List actions for a campaign with optional filters."""
        conditions = ["campaign_id = ?"]
        params: list[Any] = [campaign_id]

        if since:
            conditions.append("timestamp >= ?")
            params.append(since)
        if platform:
            conditions.append("platform = ?")
            params.append(platform)

        sql = (
            "SELECT * FROM actions"
            f" WHERE {' AND '.join(conditions)}"
            " ORDER BY timestamp DESC"
        )
        return self._fetchall(sql, tuple(params))

    # ── accounts ──────────────────────────────────────────────────────────

    def upsert_account(
        self,
        name: str,
        platform: str,
        **kwargs: Any,
    ) -> None:
        """Insert or update an account record.

        Keyword args
        ------------
        profile_name : str, optional
        status : str, optional  (default ``"active"``)
        warmup_start : str, optional
        warmup_phase : str, optional
        karma : float, optional  (default ``0.0``)
        """
        now = _now()
        existing = self._fetchone("SELECT * FROM accounts WHERE name = ?", (name,))

        if existing:
            self._execute(
                """UPDATE accounts SET
                   platform = COALESCE(?, platform),
                   profile_name = COALESCE(?, profile_name),
                   status = COALESCE(?, status),
                   warmup_start = COALESCE(?, warmup_start),
                   warmup_phase = COALESCE(?, warmup_phase),
                   karma = COALESCE(?, karma),
                   updated_at = ?
                   WHERE name = ?""",
                (
                    platform,
                    kwargs.get("profile_name"),
                    kwargs.get("status"),
                    kwargs.get("warmup_start"),
                    kwargs.get("warmup_phase"),
                    kwargs.get("karma"),
                    now,
                    name,
                ),
                commit=True,
            )
        else:
            self._execute(
                """INSERT INTO accounts
                   (name, platform, profile_name, status,
                    warmup_start, warmup_phase, karma,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    name,
                    platform,
                    kwargs.get("profile_name"),
                    kwargs.get("status", "active"),
                    kwargs.get("warmup_start"),
                    kwargs.get("warmup_phase"),
                    kwargs.get("karma", 0.0),
                    now,
                    now,
                ),
                commit=True,
            )

    def get_account(self, name: str) -> dict[str, Any] | None:
        """Return an account dict or ``None`` if not found."""
        return self._fetchone("SELECT * FROM accounts WHERE name = ?", (name,))

    def list_accounts(self, platform: str | None = None) -> list[dict[str, Any]]:
        """List all accounts, optionally filtered by *platform*."""
        if platform:
            return self._fetchall(
                "SELECT * FROM accounts WHERE platform = ? ORDER BY name",
                (platform,),
            )
        return self._fetchall("SELECT * FROM accounts ORDER BY name")

    # ── metrics ───────────────────────────────────────────────────────────

    def insert_metric(
        self,
        campaign_id: str,
        **kwargs: Any,
    ) -> int:
        """Record a campaign metric snapshot.

        Returns the auto-incremented metric ID.

        Keyword args
        ------------
        collected_at : str, optional  (default now)
        github_stars : int, optional  (default ``0``)
        npm_downloads : int, optional  (default ``0``)
        x_mentions : int, optional  (default ``0``)
        sheet_row_count : int, optional  (default ``0``)
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO metrics
               (campaign_id, collected_at,
                github_stars, npm_downloads, x_mentions,
                sheet_row_count, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                campaign_id,
                kwargs.get("collected_at", now),
                kwargs.get("github_stars", 0),
                kwargs.get("npm_downloads", 0),
                kwargs.get("x_mentions", 0),
                kwargs.get("sheet_row_count", 0),
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_metrics(
        self,
        campaign_id: str,
        since: str | None = None,
    ) -> list[dict[str, Any]]:
        """List metric snapshots for a campaign, optionally after *since*."""
        if since:
            return self._fetchall(
                "SELECT * FROM metrics"
                " WHERE campaign_id = ? AND collected_at >= ?"
                " ORDER BY collected_at DESC",
                (campaign_id, since),
            )
        return self._fetchall(
            "SELECT * FROM metrics WHERE campaign_id = ? ORDER BY collected_at DESC",
            (campaign_id,),
        )

    # ── action updates (used by marketing.sheet_sync) ─────────────────────

    def update_action(self, action_id: int, **kwargs: Any) -> None:
        """Update fields of an existing action.

        Keyword args
        ------------
        Any column of the ``actions`` table: ``status``, ``profile_name``,
        ``target_url``, ``content_preview``, ``score``, ``platform``, etc.
        """
        allowed = {
            "timestamp", "platform", "action_type", "target_url",
            "content_preview", "score", "status", "profile_name",
        }
        updates: dict[str, Any] = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        if not updates:
            return
        now = _now()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params = list(updates.values()) + [now, action_id]
        # The ``actions`` table does not have an ``updated_at`` column, so
        # we use ``timestamp`` as a proxy for last-modified time.
        self._execute(
            f"UPDATE actions SET {set_clause}, timestamp = ? WHERE id = ?",
            tuple(params),
            commit=True,
        )

    # ── sheet sync stubs (P0.6) ───────────────────────────────────────────

    def sync_to_sheet(self) -> None:
        """Stub — actual Google Sheet upload is implemented in P0.6."""
        logger.warning("sync_to_sheet() called but not yet implemented (P0.6)")

    def sync_from_sheet(self) -> None:
        """Stub — actual Google Sheet download is implemented in P0.6."""
        logger.warning("sync_from_sheet() called but not yet implemented (P0.6)")

    # ── schema extensions ─────────────────────────────────────────────────

    def execute_schema_extensions(self) -> None:
        """Create the extension tables: funnel_events, engagement_snapshots,
        ai_recommendations, campaign_performance."""
        with self._lock:
            self.conn.executescript(SCHEMA_EXTENSIONS_SQL)
            self.conn.commit()

    # ── funnel_events ──────────────────────────────────────────────────────

    def insert_funnel_event(self, **kwargs: Any) -> int:
        """Insert a funnel event. Returns the event ID.

        Keyword args
        ------------
        campaign_id : str (required)
        action_id : int, optional
        platform : str, optional  (default ``""``)
        event_type : str, optional  (default ``"awareness"``)
        engagement_type : str, optional
        signal_direction : str, optional  (default ``"neutral"``)
        source_url : str, optional
        profile_name : str, optional
        metric_value : float, optional  (default ``1.0``)
        metadata_json : str, optional  (default ``"{}"``)
        occurred_at : str, optional  (default now)
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO funnel_events
               (campaign_id, action_id, platform, event_type, engagement_type,
                signal_direction, source_url, profile_name, metric_value,
                metadata_json, occurred_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                kwargs.get("campaign_id", ""),
                kwargs.get("action_id"),
                kwargs.get("platform", ""),
                kwargs.get("event_type", "awareness"),
                kwargs.get("engagement_type"),
                kwargs.get("signal_direction", "neutral"),
                kwargs.get("source_url"),
                kwargs.get("profile_name"),
                kwargs.get("metric_value", 1.0),
                kwargs.get("metadata_json", "{}"),
                kwargs.get("occurred_at", now),
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_funnel_events(
        self,
        campaign_id: str,
        since: str | None = None,
    ) -> list[dict[str, Any]]:
        """List funnel events for a campaign, optionally after *since*."""
        if since:
            return self._fetchall(
                "SELECT * FROM funnel_events"
                " WHERE campaign_id = ? AND occurred_at >= ?"
                " ORDER BY occurred_at DESC",
                (campaign_id, since),
            )
        return self._fetchall(
            "SELECT * FROM funnel_events"
            " WHERE campaign_id = ? ORDER BY occurred_at DESC",
            (campaign_id,),
        )

    # ── engagement_snapshots ───────────────────────────────────────────────

    def insert_engagement_snapshot(self, **kwargs: Any) -> int:
        """Insert an engagement snapshot. Returns the snapshot ID.

        Keyword args
        ------------
        campaign_id : str (required)
        platform : str (required)
        snapshot_date : str (required)
        collected_at : str, optional  (default now)
        total_posts : int, optional  (default ``0``)
        total_comments : int, optional  (default ``0``)
        total_replies : int, optional  (default ``0``)
        positive_signals : int, optional  (default ``0``)
        neutral_signals : int, optional  (default ``0``)
        negative_signals : int, optional  (default ``0``)
        avg_reply_depth : float, optional  (default ``0.0``)
        unique_interactors : int, optional  (default ``0``)
        reply_rate : float, optional  (default ``0.0``)
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO engagement_snapshots
               (campaign_id, platform, snapshot_date, collected_at,
                total_posts, total_comments, total_replies,
                positive_signals, neutral_signals, negative_signals,
                avg_reply_depth, unique_interactors, reply_rate,
                created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                kwargs.get("campaign_id", ""),
                kwargs.get("platform", ""),
                kwargs.get("snapshot_date", ""),
                kwargs.get("collected_at", now),
                kwargs.get("total_posts", 0),
                kwargs.get("total_comments", 0),
                kwargs.get("total_replies", 0),
                kwargs.get("positive_signals", 0),
                kwargs.get("neutral_signals", 0),
                kwargs.get("negative_signals", 0),
                kwargs.get("avg_reply_depth", 0.0),
                kwargs.get("unique_interactors", 0),
                kwargs.get("reply_rate", 0.0),
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_engagement_snapshots(
        self,
        campaign_id: str,
        since: str | None = None,
    ) -> list[dict[str, Any]]:
        """List engagement snapshots for a campaign, optionally after *since*."""
        if since:
            return self._fetchall(
                "SELECT * FROM engagement_snapshots"
                " WHERE campaign_id = ? AND snapshot_date >= ?"
                " ORDER BY snapshot_date DESC",
                (campaign_id, since),
            )
        return self._fetchall(
            "SELECT * FROM engagement_snapshots"
            " WHERE campaign_id = ? ORDER BY snapshot_date DESC",
            (campaign_id,),
        )

    # ── campaign_performance ───────────────────────────────────────────────

    def insert_campaign_performance(self, **kwargs: Any) -> int:
        """Insert a campaign performance summary. Returns the row ID.

        Keyword args
        ------------
        campaign_id : str (required)
        computed_at : str, optional  (default now)
        awareness_count : int, optional  (default ``0``)
        engagement_count : int, optional  (default ``0``)
        interest_count : int, optional  (default ``0``)
        consideration_count : int, optional  (default ``0``)
        conversion_count : int, optional  (default ``0``)
        retention_count : int, optional  (default ``0``)
        awareness_to_engagement : float, optional  (default ``0.0``)
        engagement_to_interest : float, optional  (default ``0.0``)
        interest_to_consideration : float, optional  (default ``0.0``)
        consideration_to_conversion : float, optional  (default ``0.0``)
        conversion_to_retention : float, optional  (default ``0.0``)
        total_signals : int, optional  (default ``0``)
        positive_signals : int, optional  (default ``0``)
        negative_signals : int, optional  (default ``0``)
        signal_ratio : float, optional  (default ``0.0``)
        estimated_reach : int, optional  (default ``0``)
        engagement_rate : float, optional  (default ``0.0``)
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO campaign_performance
               (campaign_id, computed_at,
                awareness_count, engagement_count, interest_count,
                consideration_count, conversion_count, retention_count,
                awareness_to_engagement, engagement_to_interest,
                interest_to_consideration, consideration_to_conversion,
                conversion_to_retention,
                total_signals, positive_signals, negative_signals,
                signal_ratio, estimated_reach, engagement_rate,
                created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                kwargs.get("campaign_id", ""),
                kwargs.get("computed_at", now),
                kwargs.get("awareness_count", 0),
                kwargs.get("engagement_count", 0),
                kwargs.get("interest_count", 0),
                kwargs.get("consideration_count", 0),
                kwargs.get("conversion_count", 0),
                kwargs.get("retention_count", 0),
                kwargs.get("awareness_to_engagement", 0.0),
                kwargs.get("engagement_to_interest", 0.0),
                kwargs.get("interest_to_consideration", 0.0),
                kwargs.get("consideration_to_conversion", 0.0),
                kwargs.get("conversion_to_retention", 0.0),
                kwargs.get("total_signals", 0),
                kwargs.get("positive_signals", 0),
                kwargs.get("negative_signals", 0),
                kwargs.get("signal_ratio", 0.0),
                kwargs.get("estimated_reach", 0),
                kwargs.get("engagement_rate", 0.0),
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def get_campaign_performance(
        self,
        campaign_id: str,
        limit: int = 1,
    ) -> list[dict[str, Any]]:
        """Return the latest *limit* performance rows for a campaign."""
        return self._fetchall(
            "SELECT * FROM campaign_performance"
            " WHERE campaign_id = ? ORDER BY computed_at DESC LIMIT ?",
            (campaign_id, limit),
        )

    # ── ai_recommendations ─────────────────────────────────────────────────

    def insert_ai_recommendation(self, **kwargs: Any) -> int:
        """Insert an AI recommendation. Returns the recommendation ID.

        Keyword args
        ------------
        campaign_id : str (required)
        recommendation_type : str (required)
        title : str (required)
        description : str (required)
        rationale : str, optional  (default ``""``)
        expected_impact : str, optional  (default ``""``)
        confidence : float, optional  (default ``0.5``)
        status : str, optional  (default ``"pending"``)
        metrics_before : str, optional  (default ``"{}"``)
        metrics_after : str, optional  (default ``"{}"``)
        applied_at : str, optional
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO ai_recommendations
               (campaign_id, recommendation_type, title, description,
                rationale, expected_impact, confidence, status,
                metrics_before, metrics_after, applied_at,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                kwargs.get("campaign_id", ""),
                kwargs.get("recommendation_type", ""),
                kwargs.get("title", ""),
                kwargs.get("description", ""),
                kwargs.get("rationale", ""),
                kwargs.get("expected_impact", ""),
                kwargs.get("confidence", 0.5),
                kwargs.get("status", "pending"),
                kwargs.get("metrics_before", "{}"),
                kwargs.get("metrics_after", "{}"),
                kwargs.get("applied_at"),
                now,
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    # ── cron_job_log ──────────────────────────────────────────────────────

    def insert_cron_job_log(
        self,
        job_name: str,
        job_type: str,
        status: str,
        *,
        platform: str | None = None,
        started_at: str | None = None,
        completed_at: str | None = None,
        duration_ms: int | None = None,
        result_summary: str | None = None,
        error_message: str | None = None,
    ) -> int:
        """Insert a row into ``cron_job_log``.

        Returns the auto-incremented row id.
        """
        now = _now()
        cur = self._execute(
            """INSERT INTO cron_job_log
               (job_name, job_type, platform, status,
                started_at, completed_at, duration_ms,
                result_summary, error_message, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job_name,
                job_type,
                platform,
                status,
                started_at or now,
                completed_at,
                duration_ms,
                result_summary,
                error_message,
                now,
            ),
            commit=True,
        )
        return cur.lastrowid  # type: ignore[return-value]

    def update_cron_job_log(
        self,
        row_id: int,
        *,
        status: str | None = None,
        completed_at: str | None = None,
        duration_ms: int | None = None,
        result_summary: str | None = None,
        error_message: str | None = None,
    ) -> None:
        """Update a ``cron_job_log`` row (e.g. set status to 'completed')."""
        updates: dict[str, object] = {}
        if status is not None:
            updates["status"] = status
        if completed_at is not None:
            updates["completed_at"] = completed_at
        if duration_ms is not None:
            updates["duration_ms"] = duration_ms
        if result_summary is not None:
            updates["result_summary"] = result_summary
        if error_message is not None:
            updates["error_message"] = error_message
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params: list[object] = list(updates.values()) + [row_id]
        self._execute(
            f"UPDATE cron_job_log SET {set_clause} WHERE id = ?",
            tuple(params),
            commit=True,
        )

    def get_cron_job_log(
        self,
        limit: int = 20,
        *,
        job_type: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return recent ``cron_job_log`` rows, newest first."""
        conditions: list[str] = []
        params: list[Any] = []
        if job_type:
            conditions.append("job_type = ?")
            params.append(job_type)
        if status:
            conditions.append("status = ?")
            params.append(status)
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = (
            "SELECT * FROM cron_job_log"
            f"{where}"
            " ORDER BY id DESC LIMIT ?"
        )
        params.append(limit)
        return self._fetchall(sql, tuple(params))

    # ── context manager ───────────────────────────────────────────────────

    def close(self) -> None:
        """Close the database connection."""
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    def __enter__(self) -> CampaignStore:
        return self

    def __exit__(self, *exc_args: object) -> None:
        self.close()
