"""Agent performance analytics tracker (AIM-2002).

Records per-run analytics in Redis with a daily background sync to Postgres.
Follows the same patterns as workers.billing.cost_tracker.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

_RUN_KEY_PREFIX = "stas:analytics:run:"
_QUEUE_KEY = "stas:analytics:sync_queue"
_SYNC_LOCK_KEY = "stas:analytics:sync_lock"
_MAX_RETENTION_DAYS = 90


@dataclass
class AnalyticsRun:
    """Per-run analytics record stored in Redis and synced to Postgres."""

    run_id: str
    tenant_id: str = ""
    model: str = ""
    task_type: str = ""
    tokens_prompt: int = 0
    tokens_completion: int = 0
    tokens_total: int = 0
    cost_cents: int = 0
    duration_ms: int = 0
    fix_success: bool = False
    error_message: str = ""
    started_at: str = ""
    completed_at: str = ""

    def __post_init__(self) -> None:
        if not self.started_at:
            self.started_at = datetime.now(timezone.utc).isoformat()
        if self.tokens_total == 0:
            self.tokens_total = self.tokens_prompt + self.tokens_completion

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> AnalyticsRun:
        return AnalyticsRun(
            run_id=data["run_id"],
            tenant_id=data.get("tenant_id", ""),
            model=data.get("model", ""),
            task_type=data.get("task_type", ""),
            tokens_prompt=data.get("tokens_prompt", 0),
            tokens_completion=data.get("tokens_completion", 0),
            tokens_total=data.get("tokens_total", 0),
            cost_cents=data.get("cost_cents", 0),
            duration_ms=data.get("duration_ms", 0),
            fix_success=bool(data.get("fix_success", False)),
            error_message=data.get("error_message", ""),
            started_at=data.get("started_at", ""),
            completed_at=data.get("completed_at", ""),
        )


# ---------------------------------------------------------------------------
# Redis client (lazy singleton)
# ---------------------------------------------------------------------------

_REDIS_CLIENT: Optional[Any] = None
_REDIS_URL = os.getenv(
    "REDIS_URL",
    os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
)


def _get_redis() -> Any:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    try:
        import redis as _redis_mod

        _REDIS_CLIENT = _redis_mod.from_url(_REDIS_URL, decode_responses=True)
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception as exc:
        logger.warning("Analytics Redis unavailable: %s", exc)
        _REDIS_CLIENT = None
        return None


# ---------------------------------------------------------------------------
# Postgres helpers
# ---------------------------------------------------------------------------


def _get_pg_connection() -> Any:
    """Return a psycopg2 connection using DATABASE_URL or defaults."""
    db_url = os.getenv("DATABASE_URL", "postgres://localhost:5432/stas")
    try:
        import psycopg2 as _pg_mod

        conn = _pg_mod.connect(db_url)
        conn.autocommit = False
        return conn
    except Exception as exc:
        logger.warning("Analytics Postgres unavailable: %s", exc)
        return None


def _ensure_run_table(conn: Any) -> None:
    """Create the agent_analytics_runs table if it does not exist."""
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_analytics_runs (
                id              SERIAL PRIMARY KEY,
                run_id          VARCHAR(64) NOT NULL UNIQUE,
                tenant_id       VARCHAR(64) NOT NULL DEFAULT '',
                model           VARCHAR(128) NOT NULL DEFAULT '',
                task_type       VARCHAR(64) NOT NULL DEFAULT '',
                tokens_prompt   INTEGER NOT NULL DEFAULT 0,
                tokens_completion INTEGER NOT NULL DEFAULT 0,
                tokens_total    INTEGER NOT NULL DEFAULT 0,
                cost_cents      INTEGER NOT NULL DEFAULT 0,
                duration_ms     INTEGER NOT NULL DEFAULT 0,
                fix_success     BOOLEAN NOT NULL DEFAULT FALSE,
                error_message   TEXT NOT NULL DEFAULT '',
                started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at    TIMESTAMPTZ,
                synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """
        )
    conn.commit()


def _ensure_daily_table(conn: Any) -> None:
    """Create the agent_analytics_daily table if it does not exist."""
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_analytics_daily (
                id              SERIAL PRIMARY KEY,
                snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
                task_type       VARCHAR(64) NOT NULL DEFAULT '',
                model           VARCHAR(128) NOT NULL DEFAULT '',
                total_runs      INTEGER NOT NULL DEFAULT 0,
                successful_runs INTEGER NOT NULL DEFAULT 0,
                failed_runs     INTEGER NOT NULL DEFAULT 0,
                fix_rate        NUMERIC(5,4) NOT NULL DEFAULT 0,
                total_cost_cents INTEGER NOT NULL DEFAULT 0,
                avg_cost_cents  NUMERIC(10,2) NOT NULL DEFAULT 0,
                total_duration_ms BIGINT NOT NULL DEFAULT 0,
                avg_duration_ms INTEGER NOT NULL DEFAULT 0,
                total_tokens    BIGINT NOT NULL DEFAULT 0,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Tracker class
# ---------------------------------------------------------------------------


class AnalyticsTracker:
    """Records per-run analytics in Redis with Postgres sync."""

    def record_run(self, run: AnalyticsRun) -> bool:
        """Store a run record in Redis. Returns True on success."""
        client = _get_redis()
        if not client:
            logger.warning("Redis unavailable -- analytics not recorded run=%s", run.run_id)
            return False

        try:
            key = f"{_RUN_KEY_PREFIX}{run.run_id}"
            client.set(key, json.dumps(run.to_dict()))
            client.expire(key, _MAX_RETENTION_DAYS * 86_400)
            client.sadd(_QUEUE_KEY, run.run_id)
            return True
        except Exception as exc:
            logger.error("Failed to record analytics run=%s: %s", run.run_id, exc)
            return False

    def get_run(self, run_id: str) -> AnalyticsRun | None:
        """Retrieve a single run record from Redis."""
        client = _get_redis()
        if not client:
            return None
        try:
            key = f"{_RUN_KEY_PREFIX}{run_id}"
            data = client.get(key)
            if not data:
                return None
            return AnalyticsRun.from_dict(json.loads(data))
        except Exception as exc:
            logger.error("Failed to get analytics run=%s: %s", run_id, exc)
            return None

    def get_all_runs(self, limit: int = 100) -> list[AnalyticsRun]:
        """Scan Redis for all stored run records."""
        client = _get_redis()
        if not client:
            return []
        results: list[AnalyticsRun] = []
        cursor = 0
        try:
            while True:
                cursor, keys = client.scan(cursor, match=f"{_RUN_KEY_PREFIX}*", count=limit)
                for key in keys:
                    data = client.get(key)
                    if data:
                        try:
                            results.append(AnalyticsRun.from_dict(json.loads(data)))
                        except (json.JSONDecodeError, KeyError):
                            continue
                if cursor == 0 or len(results) >= limit:
                    break
        except Exception as exc:
            logger.error("Failed to scan analytics keys: %s", exc)
        results.sort(key=lambda r: r.started_at, reverse=True)
        return results[:limit]

    def count_pending_sync(self) -> int:
        """Return the number of runs waiting to be synced to Postgres."""
        client = _get_redis()
        if not client:
            return 0
        try:
            return client.scard(_QUEUE_KEY)
        except Exception as exc:
            logger.error("Failed to count pending sync: %s", exc)
            return 0

    def sync_batch_to_postgres(self, batch_size: int = 50) -> int:
        """Sync a batch of pending runs from Redis to Postgres.

        Returns the number of successfully synced records.
        """
        client = _get_redis()
        if not client:
            return 0

        locked = client.setnx(_SYNC_LOCK_KEY, datetime.now(timezone.utc).isoformat())
        if not locked:
            logger.debug("Sync already in progress -- skipping")
            return 0
        client.expire(_SYNC_LOCK_KEY, 120)

        try:
            run_ids = client.srandmember(_QUEUE_KEY, batch_size)
            if not run_ids:
                return 0

            conn = _get_pg_connection()
            if not conn:
                return 0

            try:
                _ensure_run_table(conn)
                synced = 0
                for run_id in run_ids:
                    run = self.get_run(run_id)
                    if not run:
                        client.srem(_QUEUE_KEY, run_id)
                        continue

                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                """
                                INSERT INTO agent_analytics_runs
                                    (run_id, tenant_id, model, task_type,
                                     tokens_prompt, tokens_completion, tokens_total,
                                     cost_cents, duration_ms, fix_success,
                                     error_message, started_at, completed_at, synced_at)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                                ON CONFLICT (run_id) DO UPDATE SET
                                    synced_at = NOW()
                                """,
                                (
                                    run.run_id, run.tenant_id, run.model, run.task_type,
                                    run.tokens_prompt, run.tokens_completion, run.tokens_total,
                                    run.cost_cents, run.duration_ms, run.fix_success,
                                    run.error_message,
                                    run.started_at or None,
                                    run.completed_at or None,
                                ),
                            )
                        conn.commit()
                        client.srem(_QUEUE_KEY, run_id)
                        synced += 1
                    except Exception as exc:
                        conn.rollback()
                        logger.error("Failed to sync run=%s: %s", run_id, exc)
                return synced
            finally:
                conn.close()
        finally:
            client.delete(_SYNC_LOCK_KEY)

    def compute_and_store_daily(self, snapshot_date: str | None = None) -> dict[str, Any]:
        """Compute daily aggregate stats from Postgres and store in agent_analytics_daily.

        Returns a summary dict with the number of aggregates computed.
        """
        if not snapshot_date:
            snapshot_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        conn = _get_pg_connection()
        if not conn:
            return {"status": "error", "message": "Postgres unavailable"}

        try:
            _ensure_daily_table(conn)

            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        task_type,
                        model,
                        COUNT(*) AS total_runs,
                        SUM(CASE WHEN fix_success THEN 1 ELSE 0 END) AS successful_runs,
                        SUM(CASE WHEN NOT fix_success THEN 1 ELSE 0 END) AS failed_runs,
                        COALESCE(SUM(cost_cents), 0) AS total_cost_cents,
                        COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                        COALESCE(SUM(tokens_total), 0) AS total_tokens
                    FROM agent_analytics_runs
                    WHERE DATE(started_at) = %s
                    GROUP BY task_type, model
                    """,
                    (snapshot_date,),
                )
                rows = cur.fetchall()

            computed = 0
            for row in rows:
                (
                    task_type, model, total_runs, successful_runs,
                    failed_runs, total_cost_cents, total_duration_ms, total_tokens,
                ) = row
                total_runs = int(total_runs)
                successful_runs = int(successful_runs)
                failed_runs = int(failed_runs)
                total_cost_cents = int(total_cost_cents)
                total_duration_ms = int(total_duration_ms)
                total_tokens = int(total_tokens)

                fix_rate = round(successful_runs / max(total_runs, 1), 4)
                avg_cost_cents = round(total_cost_cents / max(total_runs, 1), 2)
                avg_duration_ms = int(total_duration_ms / max(total_runs, 1)) if total_duration_ms > 0 else 0

                with conn.cursor() as cur2:
                    cur2.execute(
                        """
                        INSERT INTO agent_analytics_daily
                            (snapshot_date, task_type, model,
                             total_runs, successful_runs, failed_runs, fix_rate,
                             total_cost_cents, avg_cost_cents,
                             total_duration_ms, avg_duration_ms, total_tokens)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (snapshot_date, task_type, model)
                        DO UPDATE SET
                            total_runs = EXCLUDED.total_runs,
                            successful_runs = EXCLUDED.successful_runs,
                            failed_runs = EXCLUDED.failed_runs,
                            fix_rate = EXCLUDED.fix_rate,
                            total_cost_cents = EXCLUDED.total_cost_cents,
                            avg_cost_cents = EXCLUDED.avg_cost_cents,
                            total_duration_ms = EXCLUDED.total_duration_ms,
                            avg_duration_ms = EXCLUDED.avg_duration_ms,
                            total_tokens = EXCLUDED.total_tokens
                        """,
                        (
                            snapshot_date, task_type, model,
                            total_runs, successful_runs, failed_runs, fix_rate,
                            total_cost_cents, avg_cost_cents,
                            total_duration_ms, avg_duration_ms, total_tokens,
                        ),
                    )
                conn.commit()
                computed += 1

            return {"status": "ok", "date": snapshot_date, "aggregates_computed": computed}
        except Exception as exc:
            conn.rollback()
            logger.error("Failed to compute daily analytics: %s", exc)
            return {"status": "error", "message": str(exc)}
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Module-level convenience
# ---------------------------------------------------------------------------

_TRACKER: AnalyticsTracker | None = None


def get_tracker() -> AnalyticsTracker:
    global _TRACKER
    if _TRACKER is None:
        _TRACKER = AnalyticsTracker()
    return _TRACKER


def record_run(
    run_id: str,
    model: str = "",
    task_type: str = "",
    tokens_prompt: int = 0,
    tokens_completion: int = 0,
    cost_cents: int = 0,
    duration_ms: int = 0,
    fix_success: bool = False,
    error_message: str = "",
    tenant_id: str = "",
) -> bool:
    """Convenience: create and record an AnalyticsRun in one call."""
    run = AnalyticsRun(
        run_id=run_id,
        tenant_id=tenant_id,
        model=model,
        task_type=task_type,
        tokens_prompt=tokens_prompt,
        tokens_completion=tokens_completion,
        cost_cents=cost_cents,
        duration_ms=duration_ms,
        fix_success=fix_success,
        error_message=error_message,
    )
    return get_tracker().record_run(run)


def sync_to_postgres(batch_size: int = 50) -> int:
    """Convenience: sync pending runs to Postgres."""
    return get_tracker().sync_batch_to_postgres(batch_size=batch_size)
