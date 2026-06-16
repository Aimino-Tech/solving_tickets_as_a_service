import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

HERMES_HOME = Path(os.path.expanduser("~/.hermes"))
DB_PATH = HERMES_HOME / "monitoring.db"


class MetricsStore:
    _local = threading.local()

    def __init__(self, db_path: str | Path = DB_PATH):
        self.db_path = str(db_path)
        self._init_db()

    @property
    def conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path)
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA busy_timeout=5000")
        return self._local.conn

    def _init_db(self) -> None:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    value REAL NOT NULL,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alert_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    metric_name TEXT NOT NULL,
                    condition TEXT NOT NULL DEFAULT '>',
                    threshold REAL NOT NULL,
                    duration_seconds INTEGER NOT NULL DEFAULT 0,
                    delivery TEXT NOT NULL DEFAULT 'origin',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    last_fired_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_name_time 
                ON metrics(name, recorded_at)
            """)
            conn.commit()
        finally:
            conn.close()

    def record(self, name: str, value: float, recorded_at: str | None = None) -> None:
        if recorded_at is None:
            recorded_at = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            "INSERT INTO metrics (name, value, recorded_at) VALUES (?, ?, ?)",
            (name, value, recorded_at),
        )
        self.conn.commit()

    def query_values(self, metric_name: str, since: str | None = None) -> list[dict[str, Any]]:
        if since:
            rows = self.conn.execute(
                "SELECT value, recorded_at FROM metrics WHERE name = ? AND recorded_at >= ? ORDER BY recorded_at DESC",
                (metric_name, since),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT value, recorded_at FROM metrics WHERE name = ? ORDER BY recorded_at DESC LIMIT 1",
                (metric_name,),
            ).fetchall()
        return [dict(r) for r in rows]

    def query_latest_value(self, metric_name: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT value, recorded_at FROM metrics WHERE name = ? ORDER BY recorded_at DESC LIMIT 1",
            (metric_name,),
        ).fetchone()
        return dict(row) if row else None

    def create_alert(
        self,
        name: str,
        metric_name: str,
        condition: str,
        threshold: float,
        duration_seconds: int = 0,
        delivery: str = "origin",
    ) -> dict[str, Any]:
        self.conn.execute(
            """INSERT INTO alert_configs (name, metric_name, condition, threshold, duration_seconds, delivery)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, metric_name, condition, threshold, duration_seconds, delivery),
        )
        self.conn.commit()
        return self.get_alert(name)

    def update_alert(self, name: str, **kwargs: Any) -> dict[str, Any] | None:
        allowed = {"metric_name", "condition", "threshold", "duration_seconds", "delivery", "enabled"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return self.get_alert(name)
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [name]
        self.conn.execute(f"UPDATE alert_configs SET {set_clause} WHERE name = ?", values)
        self.conn.commit()
        return self.get_alert(name)

    def delete_alert(self, name: str) -> bool:
        c = self.conn.execute("DELETE FROM alert_configs WHERE name = ?", (name,))
        self.conn.commit()
        return c.rowcount > 0

    def get_alert(self, name: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM alert_configs WHERE name = ?", (name,)
        ).fetchone()
        return dict(row) if row else None

    def get_alert_configs(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        if enabled_only:
            rows = self.conn.execute(
                "SELECT * FROM alert_configs WHERE enabled = 1 ORDER BY name"
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM alert_configs ORDER BY name"
            ).fetchall()
        return [dict(r) for r in rows]

    def update_last_fired(self, name: str, timestamp: str | None = None) -> None:
        if timestamp is None:
            timestamp = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            "UPDATE alert_configs SET last_fired_at = ?, updated_at = ? WHERE name = ?",
            (timestamp, timestamp, name),
        )
        self.conn.commit()
