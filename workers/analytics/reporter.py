"""Agent performance analytics reporter (AIM-2002).

Aggregate queries against agent_analytics_daily and agent_analytics_runs
for the analytics API endpoints.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class DailySummary:
    """Overall summary metrics for a time range."""
    total_runs: int = 0
    successful_runs: int = 0
    failed_runs: int = 0
    fix_rate: float = 0.0
    total_cost_cents: int = 0
    avg_cost_per_fix_cents: float = 0.0
    total_duration_ms: int = 0
    avg_duration_ms: int = 0
    total_tokens: int = 0
    unique_models: int = 0
    unique_task_types: int = 0
    days_covered: int = 0
    generated_at: str = ""

    def __post_init__(self) -> None:
        if not self.generated_at:
            self.generated_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ModelPerformance:
    """Performance breakdown by model."""
    model: str = ""
    total_runs: int = 0
    successful_runs: int = 0
    failed_runs: int = 0
    fix_rate: float = 0.0
    total_cost_cents: int = 0
    avg_cost_cents: float = 0.0
    total_duration_ms: int = 0
    avg_duration_ms: int = 0
    total_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TaskTypePerformance:
    """Performance breakdown by task type."""
    task_type: str = ""
    total_runs: int = 0
    successful_runs: int = 0
    failed_runs: int = 0
    fix_rate: float = 0.0
    total_cost_cents: int = 0
    avg_cost_cents: float = 0.0
    total_duration_ms: int = 0
    avg_duration_ms: int = 0
    total_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _get_pg_connection() -> Any:
    db_url = os.getenv("DATABASE_URL", "postgres://localhost:5432/stas")
    try:
        import psycopg2 as _pg_mod
        conn = _pg_mod.connect(db_url)
        conn.autocommit = False
        return conn
    except Exception as exc:
        logger.warning("Analytics reporter Postgres unavailable: %s", exc)
        return None


class AnalyticsReporter:
    """Query agent analytics from Postgres aggregate tables."""

    def get_summary(
        self,
        days: int = 30,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> DailySummary:
        """Return overall aggregate summary for the given time range."""
        conn = _get_pg_connection()
        if not conn:
            return DailySummary()

        try:
            conditions = []
            params: list[Any] = []

            if from_date:
                conditions.append("snapshot_date >= %s")
                params.append(from_date)
            elif days:
                conditions.append("snapshot_date >= CURRENT_DATE - %s::integer")
                params.append(days)

            if to_date:
                conditions.append("snapshot_date <= %s")
                params.append(to_date)

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        COALESCE(SUM(total_runs), 0) AS total_runs,
                        COALESCE(SUM(successful_runs), 0) AS successful_runs,
                        COALESCE(SUM(failed_runs), 0) AS failed_runs,
                        COALESCE(SUM(total_cost_cents), 0) AS total_cost_cents,
                        COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms,
                        COALESCE(SUM(total_tokens), 0) AS total_tokens,
                        COUNT(DISTINCT model) AS unique_models,
                        COUNT(DISTINCT task_type) AS unique_task_types,
                        COUNT(DISTINCT snapshot_date) AS days_covered
                    FROM agent_analytics_daily
                    WHERE {where_clause}
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    return DailySummary()

            total_runs = int(row[0])
            successful_runs = int(row[1])
            failed_runs = int(row[2])
            total_cost_cents = int(row[3])
            total_duration_ms = int(row[4])
            total_tokens = int(row[5])
            unique_models = int(row[6])
            unique_task_types = int(row[7])
            days_covered = int(row[8])

            fix_rate = round(successful_runs / max(total_runs, 1), 4)
            avg_cost_per_fix_cents = round(total_cost_cents / max(successful_runs, 1), 2)
            avg_duration_ms = int(total_duration_ms / max(total_runs, 1)) if total_duration_ms > 0 else 0

            return DailySummary(
                total_runs=total_runs,
                successful_runs=successful_runs,
                failed_runs=failed_runs,
                fix_rate=fix_rate,
                total_cost_cents=total_cost_cents,
                avg_cost_per_fix_cents=avg_cost_per_fix_cents,
                total_duration_ms=total_duration_ms,
                avg_duration_ms=avg_duration_ms,
                total_tokens=total_tokens,
                unique_models=unique_models,
                unique_task_types=unique_task_types,
                days_covered=days_covered,
            )
        except Exception as exc:
            logger.error("Failed to query analytics summary: %s", exc)
            return DailySummary()
        finally:
            conn.close()

    def get_by_model(
        self,
        days: int = 30,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> list[ModelPerformance]:
        """Return performance breakdown grouped by model."""
        conn = _get_pg_connection()
        if not conn:
            return []

        try:
            conditions = []
            params: list[Any] = []

            if from_date:
                conditions.append("snapshot_date >= %s")
                params.append(from_date)
            elif days:
                conditions.append("snapshot_date >= CURRENT_DATE - %s::integer")
                params.append(days)

            if to_date:
                conditions.append("snapshot_date <= %s")
                params.append(to_date)

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        model,
                        COALESCE(SUM(total_runs), 0) AS total_runs,
                        COALESCE(SUM(successful_runs), 0) AS successful_runs,
                        COALESCE(SUM(failed_runs), 0) AS failed_runs,
                        COALESCE(SUM(total_cost_cents), 0) AS total_cost_cents,
                        COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms,
                        COALESCE(SUM(total_tokens), 0) AS total_tokens
                    FROM agent_analytics_daily
                    WHERE {where_clause}
                    GROUP BY model
                    ORDER BY total_runs DESC
                    """,
                    params,
                )
                rows = cur.fetchall()

            results: list[ModelPerformance] = []
            for row in rows:
                model = str(row[0])
                total_runs = int(row[1])
                successful_runs = int(row[2])
                failed_runs = int(row[3])
                total_cost_cents = int(row[4])
                total_duration_ms = int(row[5])
                total_tokens = int(row[6])

                fix_rate = round(successful_runs / max(total_runs, 1), 4)
                avg_cost_cents = round(total_cost_cents / max(total_runs, 1), 2)
                avg_duration_ms = int(total_duration_ms / max(total_runs, 1)) if total_duration_ms > 0 else 0

                results.append(ModelPerformance(
                    model=model,
                    total_runs=total_runs,
                    successful_runs=successful_runs,
                    failed_runs=failed_runs,
                    fix_rate=fix_rate,
                    total_cost_cents=total_cost_cents,
                    avg_cost_cents=avg_cost_cents,
                    total_duration_ms=total_duration_ms,
                    avg_duration_ms=avg_duration_ms,
                    total_tokens=total_tokens,
                ))

            return results
        except Exception as exc:
            logger.error("Failed to query analytics by model: %s", exc)
            return []
        finally:
            conn.close()

    def get_by_task_type(
        self,
        days: int = 30,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> list[TaskTypePerformance]:
        """Return performance breakdown grouped by task type."""
        conn = _get_pg_connection()
        if not conn:
            return []

        try:
            conditions = []
            params: list[Any] = []

            if from_date:
                conditions.append("snapshot_date >= %s")
                params.append(from_date)
            elif days:
                conditions.append("snapshot_date >= CURRENT_DATE - %s::integer")
                params.append(days)

            if to_date:
                conditions.append("snapshot_date <= %s")
                params.append(to_date)

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        task_type,
                        COALESCE(SUM(total_runs), 0) AS total_runs,
                        COALESCE(SUM(successful_runs), 0) AS successful_runs,
                        COALESCE(SUM(failed_runs), 0) AS failed_runs,
                        COALESCE(SUM(total_cost_cents), 0) AS total_cost_cents,
                        COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms,
                        COALESCE(SUM(total_tokens), 0) AS total_tokens
                    FROM agent_analytics_daily
                    WHERE {where_clause}
                    GROUP BY task_type
                    ORDER BY total_runs DESC
                    """,
                    params,
                )
                rows = cur.fetchall()

            results: list[TaskTypePerformance] = []
            for row in rows:
                task_type = str(row[0])
                total_runs = int(row[1])
                successful_runs = int(row[2])
                failed_runs = int(row[3])
                total_cost_cents = int(row[4])
                total_duration_ms = int(row[5])
                total_tokens = int(row[6])

                fix_rate = round(successful_runs / max(total_runs, 1), 4)
                avg_cost_cents = round(total_cost_cents / max(total_runs, 1), 2)
                avg_duration_ms = int(total_duration_ms / max(total_runs, 1)) if total_duration_ms > 0 else 0

                results.append(TaskTypePerformance(
                    task_type=task_type,
                    total_runs=total_runs,
                    successful_runs=successful_runs,
                    failed_runs=failed_runs,
                    fix_rate=fix_rate,
                    total_cost_cents=total_cost_cents,
                    avg_cost_cents=avg_cost_cents,
                    total_duration_ms=total_duration_ms,
                    avg_duration_ms=avg_duration_ms,
                    total_tokens=total_tokens,
                ))

            return results
        except Exception as exc:
            logger.error("Failed to query analytics by task type: %s", exc)
            return []
        finally:
            conn.close()

    def get_raw_runs(
        self,
        limit: int = 50,
        offset: int = 0,
        model: str | None = None,
        task_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return raw run records from Postgres with optional filters."""
        conn = _get_pg_connection()
        if not conn:
            return []

        try:
            conditions: list[str] = []
            params: list[Any] = []

            if model:
                conditions.append("model = %s")
                params.append(model)
            if task_type:
                conditions.append("task_type = %s")
                params.append(task_type)

            where_clause = " AND ".join(conditions) if conditions else "1=1"

            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                        run_id, tenant_id, model, task_type,
                        tokens_prompt, tokens_completion, tokens_total,
                        cost_cents, duration_ms, fix_success,
                        error_message, started_at, completed_at, synced_at
                    FROM agent_analytics_runs
                    WHERE {where_clause}
                    ORDER BY started_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    params + [limit, offset],
                )
                rows = cur.fetchall()

            results: list[dict[str, Any]] = []
            for row in rows:
                results.append({
                    "run_id": row[0],
                    "tenant_id": row[1],
                    "model": row[2],
                    "task_type": row[3],
                    "tokens_prompt": row[4],
                    "tokens_completion": row[5],
                    "tokens_total": row[6],
                    "cost_cents": row[7],
                    "duration_ms": row[8],
                    "fix_success": bool(row[9]),
                    "error_message": row[10],
                    "started_at": str(row[11]),
                    "completed_at": str(row[12]) if row[12] else None,
                    "synced_at": str(row[13]),
                })
            return results
        except Exception as exc:
            logger.error("Failed to query raw analytics runs: %s", exc)
            return []
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Module-level convenience
# ---------------------------------------------------------------------------

_REPORTER: AnalyticsReporter | None = None


def get_reporter() -> AnalyticsReporter:
    global _REPORTER
    if _REPORTER is None:
        _REPORTER = AnalyticsReporter()
    return _REPORTER
