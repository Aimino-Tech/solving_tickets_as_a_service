from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from workers.audit.models import AuditEvent, EventSeverity, EventType, _compute_hash

logger = logging.getLogger(__name__)

DB_PATH_ENV = "STAS_AUDIT_DB_PATH"
DEFAULT_DB_PATH = "/tmp/stas_audit.db"


class AuditTrail:
    def __init__(self, db_path: str = "") -> None:
        self._db_path = db_path or os.getenv(DB_PATH_ENV, DEFAULT_DB_PATH)
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS audit_trail (
                        event_id TEXT PRIMARY KEY,
                        prev_hash TEXT NOT NULL,
                        sha256_hash TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        severity TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        scope TEXT DEFAULT '',
                        payload TEXT NOT NULL,
                        created_at TEXT DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
                    CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_trail(event_type);
                    CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_trail(scope);
                    CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_trail(severity);
                """)
                conn.commit()
            finally:
                conn.close()

    def append_event(
        self,
        event_type: EventType | str,
        severity: EventSeverity | str,
        payload: dict[str, Any],
        scope: str = "",
    ) -> AuditEvent:
        event_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        prev_hash = self._get_latest_hash()

        event = AuditEvent(
            event_id=event_id,
            prev_hash=prev_hash,
            sha256_hash="",
            timestamp=timestamp,
            severity=EventSeverity(severity) if isinstance(severity, str) else severity,
            event_type=EventType(event_type) if isinstance(event_type, str) else event_type,
            payload=payload,
            scope=scope,
        )
        event.sha256_hash = event.compute_hash()

        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                conn.execute(
                    """INSERT INTO audit_trail (event_id, prev_hash, sha256_hash, timestamp,
                       severity, event_type, scope, payload)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        event.event_id,
                        event.prev_hash,
                        event.sha256_hash,
                        event.timestamp,
                        event.severity.value,
                        event.event_type.value if isinstance(event.event_type, EventType) else event.event_type,
                        event.scope,
                        json.dumps(event.payload),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

        logger.debug("Audit event %s appended: %s", event.event_id, event.event_type)
        return event

    def append_task_event(
        self,
        event_type: EventType | str,
        task_id: str,
        task_name: str,
        status: str,
        details: dict[str, Any] | None = None,
        severity: EventSeverity | str = EventSeverity.INFO,
        scope: str = "",
    ) -> AuditEvent:
        payload = {
            "task_id": task_id,
            "task_name": task_name,
            "status": status,
            **(details or {}),
        }
        return self.append_event(event_type, severity, payload, scope)

    def verify_chain(self, limit: int = 100) -> list[dict[str, Any]]:
        events = self.get_events(limit=limit)
        violations: list[dict[str, Any]] = []
        prev_event: AuditEvent | None = None

        for e in events:
            if not e.verify_chain(prev_event):
                violations.append({
                    "event_id": e.event_id,
                    "expected_prev_hash": _compute_hash(prev_event) if prev_event else "0" * 64,
                    "actual_prev_hash": e.prev_hash,
                    "timestamp": e.timestamp,
                })
            prev_event = e

        return violations

    def get_events(
        self,
        limit: int = 100,
        offset: int = 0,
        event_type: str | None = None,
        scope: str | None = None,
        severity: str | None = None,
    ) -> list[AuditEvent]:
        conditions: list[str] = []
        params: list[Any] = []

        if event_type:
            conditions.append("event_type = ?")
            params.append(event_type)
        if scope:
            conditions.append("scope = ?")
            params.append(scope)
        if severity:
            conditions.append("severity = ?")
            params.append(severity)

        where = " AND ".join(conditions) if conditions else "1=1"
        query = f"SELECT * FROM audit_trail WHERE {where} ORDER BY rowid DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                rows = conn.execute(query, params).fetchall()
                return [
                    AuditEvent(
                        event_id=r[0],
                        prev_hash=r[1],
                        sha256_hash=r[2],
                        timestamp=r[3],
                        severity=r[4],
                        event_type=r[5],
                        scope=r[6],
                        payload=json.loads(r[7]) if r[7] else {},
                    )
                    for r in rows
                ]
            finally:
                conn.close()

    def count_events(
        self,
        event_type: str | None = None,
        scope: str | None = None,
        severity: str | None = None,
    ) -> int:
        conditions: list[str] = []
        params: list[Any] = []
        if event_type:
            conditions.append("event_type = ?")
            params.append(event_type)
        if scope:
            conditions.append("scope = ?")
            params.append(scope)
        if severity:
            conditions.append("severity = ?")
            params.append(severity)
        where = " AND ".join(conditions) if conditions else "1=1"
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                row = conn.execute(f"SELECT COUNT(*) FROM audit_trail WHERE {where}", params).fetchone()
                return row[0] if row else 0
            finally:
                conn.close()

    def _get_latest_hash(self) -> str:
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                row = conn.execute(
                    "SELECT sha256_hash FROM audit_trail ORDER BY rowid DESC LIMIT 1"
                ).fetchone()
                return row[0] if row else "0" * 64
            finally:
                conn.close()

    def prune(self, retention_days: int = 90, severity: str | None = None) -> int:
        from datetime import timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            try:
                if severity:
                    deleted = conn.execute(
                        "DELETE FROM audit_trail WHERE timestamp < ? AND severity = ?",
                        (cutoff, severity),
                    ).rowcount
                else:
                    deleted = conn.execute(
                        "DELETE FROM audit_trail WHERE timestamp < ?", (cutoff,)
                    ).rowcount
                conn.commit()
                return deleted
            finally:
                conn.close()
