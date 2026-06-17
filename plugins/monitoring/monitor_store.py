import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from hermes_constants import get_hermes_home

_HERMES_HOME = get_hermes_home()
_MONITORING_DIR = _HERMES_HOME / "monitoring"
DB_PATH = _MONITORING_DIR / "metrics.db"


class MetricsStore:
    _local = threading.local()
    _write_lock = threading.Lock()

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
        _MONITORING_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    value REAL NOT NULL,
                    tags TEXT,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_name 
                ON metrics(name)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_ts 
                ON metrics(recorded_at)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_name_ts 
                ON metrics(name, recorded_at)
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
                CREATE INDEX IF NOT EXISTS idx_metrics_name
                ON metrics(name)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_ts
                ON metrics(recorded_at)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_name_ts
                ON metrics(name, recorded_at)
            """)
            conn.commit()
            self._migrate_v1_add_tags(conn)
        finally:
            conn.close()

    def _migrate_v1_add_tags(self, conn: sqlite3.Connection) -> None:
        try:
            conn.execute("ALTER TABLE metrics ADD COLUMN tags TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass

    def record(self, name: str, value: float, recorded_at: str | None = None, tags: dict | None = None) -> None:
        if recorded_at is None:
            recorded_at = datetime.now(timezone.utc).isoformat()
        tags_json = json.dumps(tags) if tags else None
        with self._write_lock:
            self.conn.execute(
                "INSERT INTO metrics (name, value, tags, recorded_at) VALUES (?, ?, ?, ?)",
                (name, value, tags_json, recorded_at),
            )
            self.conn.commit()

    def record_batch(self, points: list[dict[str, Any]]) -> None:
        with self._write_lock:
            rows = []
            for p in points:
                name = p["name"]
                value = p["value"]
                tags = json.dumps(p.get("tags")) if p.get("tags") else None
                ts = p.get("recorded_at") or datetime.now(timezone.utc).isoformat()
                rows.append((name, value, tags, ts))
            self.conn.executemany(
                "INSERT INTO metrics (name, value, tags, recorded_at) VALUES (?, ?, ?, ?)",
                rows,
            )
            self.conn.commit()

    def query(
        self,
        name: str,
        since: str | None = None,
        until: str | None = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        conditions = ["name = ?"]
        params: list[Any] = [name]
        if since:
            conditions.append("recorded_at >= ?")
            params.append(since)
        if until:
            conditions.append("recorded_at <= ?")
            params.append(until)
        where = " AND ".join(conditions)
        rows = self.conn.execute(
            f"SELECT value, tags, recorded_at FROM metrics WHERE {where} ORDER BY recorded_at DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
        result = []
        for r in rows:
            d = {"value": r["value"], "recorded_at": r["recorded_at"]}
            if r["tags"]:
                try:
                    d["tags"] = json.loads(r["tags"])
                except (json.JSONDecodeError, TypeError):
                    d["tags"] = r["tags"]
            result.append(d)
        return result

    def query_values(self, metric_name: str, since: str | None = None) -> list[dict[str, Any]]:
        # Legacy compatibility shim
        since_ts = None
        if since:
            try:
                dt = datetime.fromisoformat(since)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                since_ts = int(dt.timestamp())
            except (ValueError, TypeError):
                pass
        rows = self.query(metric_name, since=since_ts, limit=10000) if since_ts else self.query(metric_name, limit=1)
        result = []
        for r in rows:
            result.append({"value": r["value"], "recorded_at": r["recorded_at"]})
        return result

    def query_latest(self, name: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT value, tags, recorded_at FROM metrics WHERE name = ? ORDER BY recorded_at DESC LIMIT 1",
            (name,),
        ).fetchone()
        if not row:
            return None
        d = {"value": row["value"], "recorded_at": row["recorded_at"]}
        if row["tags"]:
            try:
                d["tags"] = json.loads(row["tags"])
            except (json.JSONDecodeError, TypeError):
                d["tags"] = row["tags"]
        return d

    def query_latest_value(self, metric_name: str) -> dict[str, Any] | None:
        latest = self.query_latest(metric_name)
        if latest:
            return {"value": latest["value"], "recorded_at": latest["recorded_at"]}
        return None

    def query_aggregate(
        self,
        name: str,
        since: str,
        agg: str = "avg",
    ) -> dict[str, Any] | None:
        agg_map = {"avg": "AVG", "min": "MIN", "max": "MAX", "sum": "SUM", "count": "COUNT"}
        sql_agg = agg_map.get(agg, "AVG")
        row = self.conn.execute(
            f"SELECT {sql_agg}(value) AS value, COUNT(*) AS count FROM metrics WHERE name = ? AND recorded_at >= ?",
            (name, since),
        ).fetchone()
        if not row or row[0] is None:
            return None
        return {"value": row["value"], "count": row["count"], "agg": agg}

    def list_metric_names(self) -> list[str]:
        rows = self.conn.execute(
            "SELECT DISTINCT name FROM metrics ORDER BY name"
        ).fetchall()
        return [r["name"] for r in rows]

    def prune(self, before_ts: str) -> int:
        with self._write_lock:
            c = self.conn.execute(
                "DELETE FROM metrics WHERE recorded_at < ?", (before_ts,)
            )
            self.conn.commit()
            return c.rowcount

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
