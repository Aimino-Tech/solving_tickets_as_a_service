"""Tests for agent performance analytics tracker and reporter (AIM-2002)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from workers.analytics.tracker import (
    AnalyticsRun,
    AnalyticsTracker,
    _QUEUE_KEY,
    _RUN_KEY_PREFIX,
    _SYNC_LOCK_KEY,
    get_tracker,
    record_run,
    sync_to_postgres,
)
from workers.analytics.reporter import (
    AnalyticsReporter,
    DailySummary,
    ModelPerformance,
    TaskTypePerformance,
    get_reporter,
)


class TestAnalyticsRun:
    def test_defaults(self):
        r = AnalyticsRun(run_id="run_1")
        assert r.run_id == "run_1"
        assert r.tenant_id == ""
        assert r.model == ""
        assert r.task_type == ""
        assert r.tokens_prompt == 0
        assert r.tokens_completion == 0
        assert r.tokens_total == 0
        assert r.cost_cents == 0
        assert r.duration_ms == 0
        assert r.fix_success is False
        assert r.error_message == ""
        assert r.started_at != ""

    def test_tokens_total_auto_sum(self):
        r = AnalyticsRun(run_id="r", tokens_prompt=100, tokens_completion=50)
        assert r.tokens_total == 150

    def test_tokens_total_explicit(self):
        r = AnalyticsRun(run_id="r", tokens_prompt=100, tokens_completion=50, tokens_total=999)
        assert r.tokens_total == 999

    def test_to_dict(self):
        r = AnalyticsRun(run_id="r", model="gpt-4", task_type="bugfix", cost_cents=42, fix_success=True)
        d = r.to_dict()
        assert d["run_id"] == "r"
        assert d["model"] == "gpt-4"
        assert d["task_type"] == "bugfix"
        assert d["cost_cents"] == 42
        assert d["fix_success"] is True

    def test_from_dict(self):
        data = {
            "run_id": "r1", "tenant_id": "t1", "model": "claude-4",
            "task_type": "feature", "tokens_prompt": 200, "tokens_completion": 100,
            "tokens_total": 300, "cost_cents": 15, "duration_ms": 5000,
            "fix_success": True, "error_message": "", "started_at": "2026-06-01T00:00:00",
            "completed_at": "2026-06-01T00:05:00",
        }
        r = AnalyticsRun.from_dict(data)
        assert r.run_id == "r1"
        assert r.model == "claude-4"
        assert r.task_type == "feature"
        assert r.tokens_total == 300
        assert r.fix_success is True

    def test_from_dict_missing_fields(self):
        data = {"run_id": "r2"}
        r = AnalyticsRun.from_dict(data)
        assert r.run_id == "r2"
        assert r.model == ""
        assert r.cost_cents == 0


class TestTrackerRecord:
    @patch("workers.analytics.tracker._get_redis")
    def test_record_run_ok(self, mock_redis):
        mock_client = MagicMock()
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        run = AnalyticsRun(run_id="r1", model="gpt-4", cost_cents=50)
        result = tracker.record_run(run)

        assert result is True
        expected_key = f"{_RUN_KEY_PREFIX}r1"
        mock_client.set.assert_called_once_with(expected_key, json.dumps(run.to_dict()))
        mock_client.expire.assert_called_once()
        mock_client.sadd.assert_called_once_with(_QUEUE_KEY, "r1")

    @patch("workers.analytics.tracker._get_redis")
    def test_record_run_redis_unavailable(self, mock_redis):
        mock_redis.return_value = None
        tracker = AnalyticsTracker()
        result = tracker.record_run(AnalyticsRun(run_id="r2"))
        assert result is False

    @patch("workers.analytics.tracker._get_redis")
    def test_record_run_redis_error(self, mock_redis):
        mock_client = MagicMock()
        mock_client.set.side_effect = Exception("Redis error")
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        result = tracker.record_run(AnalyticsRun(run_id="r3"))
        assert result is False


class TestTrackerGet:
    @patch("workers.analytics.tracker._get_redis")
    def test_get_run_found(self, mock_redis):
        mock_client = MagicMock()
        run = AnalyticsRun(run_id="r1", model="claude", cost_cents=30)
        mock_client.get.return_value = json.dumps(run.to_dict())
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        result = tracker.get_run("r1")
        assert result is not None
        assert result.run_id == "r1"
        assert result.model == "claude"

    @patch("workers.analytics.tracker._get_redis")
    def test_get_run_not_found(self, mock_redis):
        mock_client = MagicMock()
        mock_client.get.return_value = None
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        assert tracker.get_run("missing") is None

    @patch("workers.analytics.tracker._get_redis")
    def test_get_run_redis_unavailable(self, mock_redis):
        mock_redis.return_value = None
        tracker = AnalyticsTracker()
        assert tracker.get_run("r1") is None


class TestTrackerList:
    @patch("workers.analytics.tracker._get_redis")
    def test_get_all_runs(self, mock_redis):
        mock_client = MagicMock()
        run_1 = AnalyticsRun(run_id="r1", started_at="2026-06-02T00:00:00")
        run_2 = AnalyticsRun(run_id="r2", started_at="2026-06-01T00:00:00")

        mock_client.scan.return_value = (0, [f"{_RUN_KEY_PREFIX}r1", f"{_RUN_KEY_PREFIX}r2"])
        mock_client.get.side_effect = [
            json.dumps(run_1.to_dict()),
            json.dumps(run_2.to_dict()),
        ]
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        results = tracker.get_all_runs(limit=10)
        assert len(results) == 2
        assert results[0].run_id == "r1"
        assert results[1].run_id == "r2"

    @patch("workers.analytics.tracker._get_redis")
    def test_get_all_runs_empty(self, mock_redis):
        mock_client = MagicMock()
        mock_client.scan.return_value = (0, [])
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        assert tracker.get_all_runs() == []


class TestTrackerSync:
    @patch("workers.analytics.tracker._get_redis")
    @patch("workers.analytics.tracker._get_pg_connection")
    def test_sync_batch_ok(self, mock_pg, mock_redis):
        mock_client = MagicMock()
        mock_client.setnx.return_value = True
        mock_client.srandmember.return_value = ["r1", "r2"]
        mock_redis.return_value = mock_client

        run_1 = AnalyticsRun(run_id="r1", model="gpt-4", cost_cents=50, fix_success=True)
        run_2 = AnalyticsRun(run_id="r2", model="claude", cost_cents=30, fix_success=False)

        def get_side_effect(key: str) -> str | None:
            if key == f"{_RUN_KEY_PREFIX}r1":
                return json.dumps(run_1.to_dict())
            if key == f"{_RUN_KEY_PREFIX}r2":
                return json.dumps(run_2.to_dict())
            return None
        mock_client.get.side_effect = get_side_effect

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        tracker = AnalyticsTracker()
        synced = tracker.sync_batch_to_postgres(batch_size=10)

        assert synced == 2
        assert mock_client.srem.call_count == 2
        mock_client.delete.assert_called_once_with(_SYNC_LOCK_KEY)

    @patch("workers.analytics.tracker._get_redis")
    def test_sync_batch_locked(self, mock_redis):
        mock_client = MagicMock()
        mock_client.setnx.return_value = False
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        assert tracker.sync_batch_to_postgres() == 0

    @patch("workers.analytics.tracker._get_redis")
    def test_pending_sync_count(self, mock_redis):
        mock_client = MagicMock()
        mock_client.scard.return_value = 5
        mock_redis.return_value = mock_client

        tracker = AnalyticsTracker()
        assert tracker.count_pending_sync() == 5

    @patch("workers.analytics.tracker._get_redis")
    def test_pending_sync_redis_unavailable(self, mock_redis):
        mock_redis.return_value = None
        tracker = AnalyticsTracker()
        assert tracker.count_pending_sync() == 0


class TestTrackerDaily:
    @patch("workers.analytics.tracker._get_pg_connection")
    def test_compute_daily(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            ("bugfix", "gpt-4", 10, 8, 2, 500, 60000, 15000),
        ]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        tracker = AnalyticsTracker()
        result = tracker.compute_and_store_daily("2026-06-15")

        assert result["status"] == "ok"
        assert result["date"] == "2026-06-15"
        assert result["aggregates_computed"] == 1

    @patch("workers.analytics.tracker._get_pg_connection")
    def test_compute_daily_no_data(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        tracker = AnalyticsTracker()
        result = tracker.compute_and_store_daily("2026-06-15")
        assert result["status"] == "ok"
        assert result["aggregates_computed"] == 0

    @patch("workers.analytics.tracker._get_pg_connection")
    def test_compute_daily_pg_unavailable(self, mock_pg):
        mock_pg.return_value = None
        tracker = AnalyticsTracker()
        result = tracker.compute_and_store_daily("2026-06-15")
        assert result["status"] == "error"


class TestTrackerConvenience:
    @patch("workers.analytics.tracker._get_redis")
    def test_record_run_convenience(self, mock_redis):
        mock_client = MagicMock()
        mock_redis.return_value = mock_client

        result = record_run(
            run_id="r1", model="gpt-4", task_type="bugfix",
            cost_cents=50, duration_ms=10000, fix_success=True,
        )
        assert result is True

    @patch("workers.analytics.tracker.get_tracker")
    def test_sync_to_postgres_convenience(self, mock_get_tracker):
        mock_tracker = MagicMock()
        mock_tracker.sync_batch_to_postgres.return_value = 3
        mock_get_tracker.return_value = mock_tracker

        assert sync_to_postgres(batch_size=20) == 3
        mock_tracker.sync_batch_to_postgres.assert_called_once_with(batch_size=20)


class TestReporterSummary:
    @patch("workers.analytics.reporter._get_pg_connection")
    def test_summary_returns_data(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (
            100, 80, 20, 5000, 200000, 30000, 3, 4, 30,
        )
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        summary = reporter.get_summary(days=30)

        assert summary.total_runs == 100
        assert summary.successful_runs == 80
        assert summary.failed_runs == 20
        assert summary.fix_rate == 0.8
        assert summary.total_cost_cents == 5000
        assert summary.avg_cost_per_fix_cents == 62.5
        assert summary.total_duration_ms == 200000
        assert summary.avg_duration_ms == 2000
        assert summary.total_tokens == 30000
        assert summary.unique_models == 3
        assert summary.unique_task_types == 4
        assert summary.days_covered == 30

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_summary_empty(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        summary = reporter.get_summary(days=30)
        assert summary.total_runs == 0
        assert summary.fix_rate == 0.0

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_summary_pg_unavailable(self, mock_pg):
        mock_pg.return_value = None
        reporter = AnalyticsReporter()
        summary = reporter.get_summary()
        assert summary.total_runs == 0


class TestReporterByModel:
    @patch("workers.analytics.reporter._get_pg_connection")
    def test_by_model_returns_data(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            ("gpt-4", 60, 50, 10, 3000, 120000, 18000),
            ("claude", 40, 30, 10, 2000, 80000, 12000),
        ]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        models = reporter.get_by_model(days=30)

        assert len(models) == 2

        assert models[0].model == "gpt-4"
        assert models[0].total_runs == 60
        assert models[0].successful_runs == 50
        assert models[0].fix_rate == pytest.approx(50 / 60, 0.001)
        assert models[0].avg_cost_cents == 50.0
        assert models[0].avg_duration_ms == 2000

        assert models[1].model == "claude"
        assert models[1].total_runs == 40
        assert models[1].fix_rate == pytest.approx(30 / 40, 0.001)

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_by_model_empty(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        assert reporter.get_by_model() == []

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_by_model_pg_unavailable(self, mock_pg):
        mock_pg.return_value = None
        reporter = AnalyticsReporter()
        assert reporter.get_by_model() == []


class TestReporterByTaskType:
    @patch("workers.analytics.reporter._get_pg_connection")
    def test_by_task_returns_data(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            ("bugfix", 50, 45, 5, 2500, 100000, 15000),
            ("feature", 30, 20, 10, 2000, 90000, 10000),
            ("refactor", 20, 15, 5, 500, 30000, 5000),
        ]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        tasks = reporter.get_by_task_type(days=30)

        assert len(tasks) == 3

        assert tasks[0].task_type == "bugfix"
        assert tasks[0].fix_rate == pytest.approx(0.9, 0.001)
        assert tasks[0].avg_cost_cents == 50.0

        assert tasks[1].task_type == "feature"
        assert tasks[2].task_type == "refactor"

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_by_task_empty(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        assert reporter.get_by_task_type() == []

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_by_task_pg_unavailable(self, mock_pg):
        mock_pg.return_value = None
        reporter = AnalyticsReporter()
        assert reporter.get_by_task_type() == []


class TestReporterRawRuns:
    @patch("workers.analytics.reporter._get_pg_connection")
    def test_raw_runs(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = [
            ("r1", "t1", "gpt-4", "bugfix", 100, 50, 150, 25, 5000, True, "", "2026-06-01T00:00:00Z", "2026-06-01T00:05:00Z", "2026-06-01T01:00:00Z"),
            ("r2", "t1", "claude", "feature", 200, 100, 300, 15, 3000, False, "timeout", "2026-06-02T00:00:00Z", None, "2026-06-02T01:00:00Z"),
        ]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        runs = reporter.get_raw_runs(limit=10)
        assert len(runs) == 2
        assert runs[0]["run_id"] == "r1"
        assert runs[0]["fix_success"] is True
        assert runs[1]["run_id"] == "r2"
        assert runs[1]["fix_success"] is False
        assert runs[1]["completed_at"] is None

    @patch("workers.analytics.reporter._get_pg_connection")
    def test_raw_runs_with_filters(self, mock_pg):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pg.return_value = mock_conn

        reporter = AnalyticsReporter()
        runs = reporter.get_raw_runs(model="gpt-4", task_type="bugfix")
        assert runs == []


class TestReporterConvenience:
    def test_get_reporter_singleton(self):
        r1 = get_reporter()
        r2 = get_reporter()
        assert r1 is r2


class TestDataclassConversions:
    def test_daily_summary_to_dict(self):
        s = DailySummary(total_runs=10)
        d = s.to_dict()
        assert d["total_runs"] == 10
        assert "generated_at" in d

    def test_model_performance_to_dict(self):
        m = ModelPerformance(model="gpt-4", total_runs=5)
        d = m.to_dict()
        assert d["model"] == "gpt-4"
        assert d["total_runs"] == 5

    def test_task_type_performance_to_dict(self):
        t = TaskTypePerformance(task_type="bugfix")
        d = t.to_dict()
        assert d["task_type"] == "bugfix"


class TestTrackerSingleton:
    def test_get_tracker_singleton(self):
        t1 = get_tracker()
        t2 = get_tracker()
        assert t1 is t2
