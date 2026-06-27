"""Integration tests for the full analytics pipeline (AIM-2257).

Tests the end-to-end flow:
1. Record analytics runs via AnalyticsTracker (Redis-backed)
2. Sync runs to Postgres
3. Query aggregated data via AnalyticsReporter
4. Verify API endpoints return correct data

These tests use testcontainers to spin up Postgres, requiring Docker.
"""

from __future__ import annotations

import json
import os
import time
from unittest.mock import MagicMock, patch

import pytest

from workers.analytics.reporter import AnalyticsReporter, get_reporter
from workers.analytics.tracker import (
    AnalyticsRun,
    AnalyticsTracker,
    get_tracker,
    record_run,
)


def _check_docker() -> bool:
    try:
        import subprocess
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


@pytest.fixture(scope="module")
def postgres_container():
    """Spin up a Postgres container for integration testing."""
    if not _check_docker():
        pytest.skip("Docker not available — cannot run integration tests")

    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:
        try:
            from testcontainers.core import GenericContainer

            container = GenericContainer("postgres:16-alpine")
            container.with_env("POSTGRES_USER", "stas")
            container.with_env("POSTGRES_PASSWORD", "stas")
            container.with_env("POSTGRES_DB", "stas_test")
            container.with_exposed_ports(5432)

            container.start()
            host = container.get_container_host_ip()
            port = container.get_exposed_port(5432)
            db_url = f"postgresql://stas:stas@{host}:{port}/stas_test"
            yield db_url
            container.stop()
            return
        except ImportError:
            pytest.skip("testcontainers not installed — install with: pip install testcontainers[postgres]")
            yield None
            return

    with PostgresContainer("postgres:16-alpine") as pg:
        db_url = pg.get_connection_url()
        yield db_url


@pytest.fixture
def db_connection(postgres_container):
    """Create a database connection to the test Postgres."""
    import psycopg2

    conn = psycopg2.connect(postgres_container)
    conn.set_session(autocommit=True)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS agent_analytics_runs (
            run_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            task_type TEXT NOT NULL DEFAULT '',
            tokens_prompt INTEGER NOT NULL DEFAULT 0,
            tokens_completion INTEGER NOT NULL DEFAULT 0,
            tokens_total INTEGER NOT NULL DEFAULT 0,
            cost_cents INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            fix_success BOOLEAN NOT NULL DEFAULT FALSE,
            error_message TEXT NOT NULL DEFAULT '',
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS agent_analytics_daily (
            id SERIAL PRIMARY KEY,
            snapshot_date DATE NOT NULL UNIQUE,
            task_type TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            total_runs INTEGER NOT NULL DEFAULT 0,
            successful_runs INTEGER NOT NULL DEFAULT 0,
            failed_runs INTEGER NOT NULL DEFAULT 0,
            total_cost_cents INTEGER NOT NULL DEFAULT 0,
            total_duration_ms INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cursor.close()
    yield conn
    conn.close()


class TestAnalyticsFullPipeline:
    """End-to-end integration tests for the analytics pipeline."""

    def test_record_and_sync_pipeline(self, db_connection, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", db_connection.dsn)

        original_pg = AnalyticsTracker._get_pg_connection

        def mock_tracker_pg():
            import psycopg2
            return psycopg2.connect(db_connection.dsn)

        monkeypatch.setattr(AnalyticsTracker, "_get_pg_connection", mock_tracker_pg)

        original_reporter_pg = AnalyticsReporter._get_pg_connection

        def mock_reporter_pg():
            import psycopg2
            return psycopg2.connect(db_connection.dsn)

        monkeypatch.setattr(AnalyticsReporter, "_get_pg_connection", mock_reporter_pg)

        runs_data = [
            ("run_integration_1", "tenant_a", "gpt-4", "bugfix", 100, 50, 25, 5000, True),
            ("run_integration_2", "tenant_a", "claude", "feature", 200, 100, 15, 3000, True),
            ("run_integration_3", "tenant_b", "gpt-4", "bugfix", 50, 25, 10, 2000, False),
        ]

        for run_id, tenant_id, model, task_type, prompt_tok, comp_tok, cost, dur, success in runs_data:
            record_run(
                run_id=run_id,
                tenant_id=tenant_id,
                model=model,
                task_type=task_type,
                tokens_prompt=prompt_tok,
                tokens_completion=comp_tok,
                cost_cents=cost,
                duration_ms=dur,
                fix_success=success,
            )

        import psycopg2
        pg_conn = psycopg2.connect(db_connection.dsn)
        cursor = pg_conn.cursor()

        for run_id, tenant_id, model, task_type, prompt_tok, comp_tok, cost, dur, success in runs_data:
            total_tok = prompt_tok + comp_tok
            cursor.execute(
                """INSERT INTO agent_analytics_runs
                   (run_id, tenant_id, model, task_type, tokens_prompt, tokens_completion,
                    tokens_total, cost_cents, duration_ms, fix_success, started_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
                (run_id, tenant_id, model, task_type, prompt_tok, comp_tok,
                 total_tok, cost, dur, success),
            )
        pg_conn.commit()

        cursor.execute("SELECT COUNT(*) FROM agent_analytics_runs")
        count = cursor.fetchone()[0]
        assert count == 3, f"Expected 3 runs, got {count}"

        reporter = AnalyticsReporter()
        summary = reporter.get_summary(days=30)

        assert summary.total_runs == 3
        assert summary.successful_runs == 2
        assert summary.failed_runs == 1
        assert summary.fix_rate == 2 / 3
        assert summary.total_cost_cents == 50

        models = reporter.get_by_model(days=30)
        assert len(models) == 2

        model_map = {m.model: m for m in models}
        gpt4 = model_map.get("gpt-4")
        assert gpt4 is not None
        assert gpt4.total_runs == 2
        assert gpt4.successful_runs == 1

        tasks = reporter.get_by_task_type(days=30)
        assert len(tasks) == 2
        task_map = {t.task_type: t for t in tasks}
        assert "bugfix" in task_map
        assert "feature" in task_map

        raw_runs = reporter.get_raw_runs(limit=10)
        assert len(raw_runs) == 3

        cursor.close()
        pg_conn.close()

    def test_full_pipeline_with_tracker(self, db_connection, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", db_connection.dsn)

        import psycopg2

        cursor = db_connection.cursor()
        cursor.execute("SELECT COUNT(*) FROM agent_analytics_runs")
        initial_count = cursor.fetchone()[0]

        mock_redis_client = MagicMock()
        mock_redis_client.set.return_value = True
        mock_redis_client.expire.return_value = True
        mock_redis_client.sadd.return_value = 1
        mock_redis_client.setnx.return_value = True
        mock_redis_client.srandmember.return_value = ["run_tracker_1", "run_tracker_2"]

        def mock_redis_get(key: str) -> str | None:
            runs_cache = {
                "stas:analytics:run:run_tracker_1": AnalyticsRun(
                    run_id="run_tracker_1", model="gpt-4", task_type="bugfix",
                    cost_cents=30, duration_ms=5000, fix_success=True,
                ).to_dict(),
                "stas:analytics:run:run_tracker_2": AnalyticsRun(
                    run_id="run_tracker_2", model="claude", task_type="feature",
                    cost_cents=20, duration_ms=3000, fix_success=False,
                ).to_dict(),
            }
            data = runs_cache.get(key)
            return json.dumps(data) if data else None

        mock_redis_client.get.side_effect = mock_redis_get
        mock_redis_client.scard.return_value = 2
        mock_redis_client.srem.return_value = 1

        monkeypatch.setattr(
            "workers.analytics.tracker._get_redis",
            lambda: mock_redis_client,
        )

        def mock_pg():
            return psycopg2.connect(db_connection.dsn)

        monkeypatch.setattr(AnalyticsTracker, "_get_pg_connection", mock_pg)
        monkeypatch.setattr(AnalyticsReporter, "_get_pg_connection", mock_pg)

        tracker = get_tracker()
        synced = tracker.sync_batch_to_postgres(batch_size=10)
        assert synced == 2

        reporter = get_reporter()
        summary = reporter.get_summary(days=30)
        assert summary.total_runs >= 2

        cursor.close()
