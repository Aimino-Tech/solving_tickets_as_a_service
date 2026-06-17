"""Tests for the cron_job_log write-on-execution feature.

Covers ``_run_with_cron_logging`` from ``cron.hermes_marketing_check``:
success path, failure path, and duration accuracy.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from cron.hermes_marketing_check import _compute_duration_ms, _run_with_cron_logging


# ===================================================================
# Fixtures
# ===================================================================


@pytest.fixture
def mock_store() -> MagicMock:
    """Return a mocked ``CampaignStore``."""
    store = MagicMock()
    store.insert_cron_job_log.return_value = 1001
    return store


# ===================================================================
# _run_with_cron_logging — success path
# ===================================================================


class TestRunWithCronLoggingSuccess:
    def test_records_running_then_completed(
        self, mock_store: MagicMock,
    ) -> None:
        """A successful function call records ``running`` then ``completed``."""
        def fake_work() -> str | None:
            return None

        result = _run_with_cron_logging(
            fake_work, (),
            job_name="test-job", job_type="monitor", store=mock_store,
        )

        assert result is None

        # Should have inserted a 'running' row
        mock_store.insert_cron_job_log.assert_called_once()
        call_kwargs = mock_store.insert_cron_job_log.call_args[1]
        assert call_kwargs["job_name"] == "test-job"
        assert call_kwargs["job_type"] == "monitor"
        assert call_kwargs["status"] == "running"

        # Should have updated to 'completed'
        mock_store.update_cron_job_log.assert_called_once()
        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["status"] == "completed"
        assert update_kwargs["completed_at"] is not None
        assert update_kwargs["duration_ms"] is not None

    def test_duration_ms_positive(
        self, mock_store: MagicMock,
    ) -> None:
        """duration_ms should be a positive integer."""
        def slow_work() -> str | None:
            time.sleep(0.01)  # 10 ms
            return None

        _run_with_cron_logging(
            slow_work, (),
            job_name="slow-job", job_type="monitor", store=mock_store,
        )

        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["duration_ms"] >= 5  # at least ~5 ms

    def test_result_summary_included(
        self, mock_store: MagicMock,
    ) -> None:
        """When the function returns a string, result_summary is populated."""
        def work_with_result() -> str | None:
            return "All good — 42 rows processed"

        _run_with_cron_logging(
            work_with_result, (),
            job_name="summary-job", job_type="sync", store=mock_store,
        )

        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["result_summary"] == "All good — 42 rows processed"

    def test_result_summary_truncated(
        self, mock_store: MagicMock,
    ) -> None:
        """Long result summaries should be truncated to 500 chars."""
        long_result = "x" * 1000

        def long_work() -> str | None:
            return long_result

        _run_with_cron_logging(
            long_work, (),
            job_name="long-job", job_type="monitor", store=mock_store,
        )

        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["result_summary"] is not None
        assert len(update_kwargs["result_summary"]) == 500


# ===================================================================
# _run_with_cron_logging — failure path
# ===================================================================


class TestRunWithCronLoggingFailure:
    def test_records_failed_on_exception(
        self, mock_store: MagicMock,
    ) -> None:
        """When the wrapped function raises, status should be 'failed'."""

        def failing_work() -> str | None:
            msg = "Sheet API timeout"
            raise RuntimeError(msg)

        with pytest.raises(RuntimeError, match="Sheet API timeout"):
            _run_with_cron_logging(
                failing_work, (),
                job_name="failing-job", job_type="sync", store=mock_store,
            )

        # Should still have inserted
        mock_store.insert_cron_job_log.assert_called_once()
        insert_kwargs = mock_store.insert_cron_job_log.call_args[1]
        assert insert_kwargs["status"] == "running"

        # Should have updated to 'failed'
        mock_store.update_cron_job_log.assert_called_once()
        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["status"] == "failed"
        assert "Sheet API timeout" in (update_kwargs["error_message"] or "")
        assert update_kwargs["completed_at"] is not None
        assert update_kwargs["duration_ms"] is not None

    def test_error_message_truncated(
        self, mock_store: MagicMock,
    ) -> None:
        """Long error messages should be truncated to 1000 chars."""

        def very_failing_work() -> str | None:
            raise RuntimeError("x" * 2000)

        with pytest.raises(RuntimeError):
            _run_with_cron_logging(
                very_failing_work, (),
                job_name="long-error", job_type="monitor", store=mock_store,
            )

        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["error_message"] is not None
        assert len(update_kwargs["error_message"]) == 1000

    def test_reraises_original_exception(
        self, mock_store: MagicMock,
    ) -> None:
        """The original exception should propagate after logging."""

        def fatal_work() -> str | None:
            raise ValueError("permission denied")

        with pytest.raises(ValueError, match="permission denied"):
            _run_with_cron_logging(
                fatal_work, (),
                job_name="fatal-job", job_type="monitor", store=mock_store,
            )

    def test_duration_ms_on_failure(
        self, mock_store: MagicMock,
    ) -> None:
        """duration_ms should still be computed on failure."""

        def quick_fail() -> str | None:
            raise RuntimeError("fail fast")

        with pytest.raises(RuntimeError):
            _run_with_cron_logging(
                quick_fail, (),
                job_name="quick-fail", job_type="sync", store=mock_store,
            )

        update_kwargs = mock_store.update_cron_job_log.call_args[1]
        assert update_kwargs["duration_ms"] >= 0


# ===================================================================
# _compute_duration_ms
# ===================================================================


class TestComputeDurationMs:
    def test_zero_duration(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        assert _compute_duration_ms(now, now) == 0

    def test_positive_duration(self) -> None:
        start = datetime.now(timezone.utc).isoformat()
        end = datetime.now(timezone.utc).isoformat()
        # Real elapsed will be tiny but >= 0
        assert _compute_duration_ms(start, end) >= 0

    def test_approximate_duration(self) -> None:
        start = "2026-06-16T10:00:00.000000+00:00"
        end = "2026-06-16T10:00:01.500000+00:00"  # 1.5 seconds later
        assert _compute_duration_ms(start, end) == 1500


# ===================================================================
# Integration-style: real CampaignStore
# ===================================================================


class TestWithRealStore:
    def test_round_trip_via_store(
        self, tmp_path: Path,
    ) -> None:
        """Verify that logging actually persists rows to the DB."""
        from marketing.store import CampaignStore

        db_path = str(tmp_path / "test_cron.db")
        store = CampaignStore(db_path=db_path)

        def dummy_work() -> str | None:
            return "done"

        _run_with_cron_logging(
            dummy_work, (),
            job_name="integration-test", job_type="monitor", store=store,
        )

        rows = store.get_cron_job_log(limit=10)
        assert len(rows) >= 1

        row = rows[0]
        assert row["job_name"] == "integration-test"
        assert row["job_type"] == "monitor"
        assert row["status"] == "completed"
        assert row["started_at"] is not None
        assert row["completed_at"] is not None
        assert row["duration_ms"] is not None and row["duration_ms"] >= 0
        assert row["result_summary"] == "done"

    def test_failure_round_trip_via_store(
        self, tmp_path: Path,
    ) -> None:
        """Verify that a failed execution persists the error row."""
        from marketing.store import CampaignStore

        db_path = str(tmp_path / "test_cron_fail.db")
        store = CampaignStore(db_path=db_path)

        def failing_work() -> str | None:
            raise OSError("connection refused")

        with pytest.raises(OSError, match="connection refused"):
            _run_with_cron_logging(
                failing_work, (),
                job_name="fail-integration", job_type="sync", store=store,
            )

        rows = store.get_cron_job_log(limit=10)
        assert len(rows) >= 1

        row = rows[0]
        assert row["job_name"] == "fail-integration"
        assert row["status"] == "failed"
        assert "connection refused" in (row["error_message"] or "")
        assert row["completed_at"] is not None
        assert row["duration_ms"] is not None and row["duration_ms"] >= 0
