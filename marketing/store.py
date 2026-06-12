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
