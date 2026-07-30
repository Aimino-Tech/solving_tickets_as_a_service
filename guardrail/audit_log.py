"""
Persistent SQLite/PostgreSQL-backed audit logger for guardrail events.

Replaces the previous in-memory default with a configurable persistent
path.  Token budget tracking has been removed — delegated to LiteLLM's
native ``/spend/`` endpoints.

Backend selection:
  - GUARDRAIL_AUDIT_BACKEND=postgres → PostgreSQL via psycopg2
  - default → SQLite
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_AUDIT_BACKEND = os.environ.get("GUARDRAIL_AUDIT_BACKEND", "sqlite").lower()
_PG_DSN = os.environ.get("GUARDRAIL_PG_DSN", "")

_DEFAULT_DB_PATH = os.environ.get(
    "GUARDRAIL_AUDIT_DB_PATH",
    str(Path.home() / ".guardrail" / "audit.db"),
)

_local = threading.local()


def _get_db_path() -> str:
    return os.environ.get("GUARDRAIL_AUDIT_DB_PATH") or _DEFAULT_DB_PATH


def _ensure_dir(path: str) -> None:
    parent = Path(path).parent
    if not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)


def _get_pg_connection() -> Any:
    if not hasattr(_local, "pg_conn") or _local.pg_conn is None:
        try:
            import psycopg2
        except ImportError:
            raise ImportError(
                "psycopg2 is required for PostgreSQL audit backend. "
                "Install: pip install psycopg2-binary"
            )
        dsn = _PG_DSN or os.environ.get(
            "GUARDRAIL_PG_DSN",
            f"host={os.environ.get('GUARDRAIL_PG_HOST', 'localhost')} "
            f"port={os.environ.get('GUARDRAIL_PG_PORT', '5432')} "
            f"dbname={os.environ.get('GUARDRAIL_PG_DB', 'guardrail')} "
            f"user={os.environ.get('GUARDRAIL_PG_USER', 'guardrail')} "
            f"password={os.environ.get('GUARDRAIL_PG_PASSWORD', 'guardrail')}",
        )
        _local.pg_conn = psycopg2.connect(dsn)
        _local.pg_conn.autocommit = True
    return _local.pg_conn


@contextmanager
def _get_connection(db_path: str | None = None) -> Any:
    if _AUDIT_BACKEND == "postgres":
        conn = _get_pg_connection()
        yield conn
        return
    path = db_path or _get_db_path()
    _ensure_dir(path)
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(path)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA busy_timeout=5000")
    yield _local.conn


def _sql(sqlite_sql: str, pg_sql: str) -> str:
    return pg_sql if _AUDIT_BACKEND == "postgres" else sqlite_sql


def init_db(db_path: str | None = None) -> None:
    with _get_connection(db_path) as conn:
        if _AUDIT_BACKEND == "postgres":
            conn.execute("""
                CREATE TABLE IF NOT EXISTS guardrail_audit_log (
                    id          SERIAL PRIMARY KEY,
                    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    guardrail   TEXT NOT NULL,
                    decision    TEXT NOT NULL,
                    model       TEXT,
                    source      TEXT,
                    pattern     TEXT,
                    snippet     TEXT,
                    metadata    TEXT
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_timestamp
                    ON guardrail_audit_log(timestamp)
            """)
        else:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS guardrail_audit_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                    guardrail   TEXT    NOT NULL,
                    decision    TEXT    NOT NULL,
                    model       TEXT,
                    source      TEXT,
                    pattern     TEXT,
                    snippet     TEXT,
                    metadata    TEXT
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_timestamp
                    ON guardrail_audit_log(timestamp)
            """)
        conn.commit()


def _execute_sql(conn: Any, sql: str, params: tuple = ()) -> Any:
    if _AUDIT_BACKEND == "postgres":
        sql = sql.replace("?", "%s")
    return conn.execute(sql, params)


def log_event(
    guardrail: str,
    decision: str,
    model: str | None = None,
    source: str | None = None,
    pattern: str | None = None,
    snippet: str | None = None,
    metadata: dict[str, Any] | None = None,
    db_path: str | None = None,
) -> int:
    with _get_connection(db_path) as conn:
        if _AUDIT_BACKEND == "postgres":
            sql = """
                INSERT INTO guardrail_audit_log
                    (guardrail, decision, model, source, pattern, snippet, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """
            params = (
                guardrail, decision, model, source, pattern, snippet,
                json.dumps(metadata) if metadata else None,
            )
            cur = conn.execute(sql, params)
            row_id = cur.fetchone()[0]
        else:
            sql = """
                INSERT INTO guardrail_audit_log
                    (guardrail, decision, model, source, pattern, snippet, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """
            params = (
                guardrail, decision, model, source, pattern, snippet,
                json.dumps(metadata) if metadata else None,
            )
            cur = conn.execute(sql, params)
            row_id = cur.lastrowid or 0
        conn.commit()
        return row_id


def query_events(
    limit: int = 100,
    offset: int = 0,
    guardrail: str | None = None,
    decision: str | None = None,
    since: str | None = None,
    db_path: str | None = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if guardrail:
        clauses.append("guardrail = ?")
        params.append(guardrail)
    if decision:
        clauses.append("decision = ?")
        params.append(decision)
    if since:
        clauses.append("timestamp >= ?")
        params.append(since)
    where = " AND ".join(clauses)
    with _get_connection(db_path) as conn:
        if _AUDIT_BACKEND == "postgres":
            pg_sql = f"SELECT * FROM guardrail_audit_log WHERE {where.replace('?', '%s')} ORDER BY timestamp DESC LIMIT %s OFFSET %s"
            rows = conn.execute(pg_sql, (*params, limit, offset)).fetchall()
            return [dict(r) for r in rows]
        rows = conn.execute(
            f"SELECT * FROM guardrail_audit_log WHERE {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def count_events(
    guardrail: str | None = None,
    decision: str | None = None,
    since: str | None = None,
    db_path: str | None = None,
) -> int:
    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if guardrail:
        clauses.append("guardrail = ?")
        params.append(guardrail)
    if decision:
        clauses.append("decision = ?")
        params.append(decision)
    if since:
        clauses.append("timestamp >= ?")
        params.append(since)
    where = " AND ".join(clauses)
    with _get_connection(db_path) as conn:
        if _AUDIT_BACKEND == "postgres":
            pg_sql = f"SELECT COUNT(*) as cnt FROM guardrail_audit_log WHERE {where.replace('?', '%s')}"
            row = conn.execute(pg_sql, params).fetchone()
            return row["cnt"] if row else 0
        row = conn.execute(
            f"SELECT COUNT(*) as cnt FROM guardrail_audit_log WHERE {where}",
            params,
        ).fetchone()
        return row["cnt"] if row else 0


def close() -> None:
    if hasattr(_local, "conn") and _local.conn is not None:
        _local.conn.close()
        _local.conn = None
    if hasattr(_local, "pg_conn") and _local.pg_conn is not None:
        _local.pg_conn.close()
        _local.pg_conn = None
