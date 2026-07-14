"""
Persistent SQLite-backed memory service for guardrail modules.

Stores guardrail decisions, pattern hits, and related metadata for
later query and dashboard consumption.
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

_DEFAULT_DB_PATH = os.environ.get(
    "GUARDRAIL_MEMORY_DB_PATH",
    str(Path.home() / ".guardrail" / "memory.db"),
)

_local = threading.local()


def _get_db_path() -> str:
    return os.environ.get("GUARDRAIL_MEMORY_DB_PATH") or _DEFAULT_DB_PATH


def _ensure_dir(path: str) -> None:
    parent = Path(path).parent
    if not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def _get_connection(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or _get_db_path()
    _ensure_dir(path)
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(path)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA busy_timeout=5000")
    yield _local.conn


def init_db(db_path: str | None = None) -> None:
    with _get_connection(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS guardrail_memory (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                key         TEXT    NOT NULL,
                value       TEXT    NOT NULL,
                guardrail   TEXT,
                model       TEXT,
                metadata    TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_memory_key
                ON guardrail_memory(key)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_memory_timestamp
                ON guardrail_memory(timestamp)
        """)
        conn.commit()


def store(
    key: str,
    value: str,
    guardrail: str | None = None,
    model: str | None = None,
    metadata: dict[str, Any] | None = None,
    db_path: str | None = None,
) -> int:
    with _get_connection(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO guardrail_memory
                (key, value, guardrail, model, metadata)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                key,
                value,
                guardrail,
                model,
                json.dumps(metadata) if metadata else None,
            ),
        )
        conn.commit()
        return cur.lastrowid or 0


def retrieve(
    key: str,
    limit: int = 10,
    db_path: str | None = None,
) -> list[dict[str, Any]]:
    with _get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM guardrail_memory WHERE key = ? ORDER BY timestamp DESC LIMIT ?",
            (key, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def query(
    guardrail: str | None = None,
    model: str | None = None,
    since: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db_path: str | None = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if guardrail:
        clauses.append("guardrail = ?")
        params.append(guardrail)
    if model:
        clauses.append("model = ?")
        params.append(model)
    if since:
        clauses.append("timestamp >= ?")
        params.append(since)
    where = " AND ".join(clauses)
    with _get_connection(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM guardrail_memory WHERE {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def close() -> None:
    if hasattr(_local, "conn") and _local.conn is not None:
        _local.conn.close()
        _local.conn = None
