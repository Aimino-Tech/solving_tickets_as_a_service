"""
Comprehensive tests for the KPI ETL daily aggregation task (AIM-2080).

Covers:
    workers.tasks.kpi_etl.compute_daily_kpi  — Full ETL pipeline
    workers.tasks.kpi_etl._compute_active_repos_ma
    workers.tasks.kpi_etl._compute_runs_stats
    workers.tasks.kpi_etl._compute_free_to_paid_conversion
    workers.tasks.kpi_etl._compute_account_counts
    workers.tasks.kpi_etl._compute_churn
    workers.tasks.kpi_etl._compute_viral_coefficient
    workers.tasks.kpi_etl._compute_net_revenue_cents
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.tasks.kpi_etl import (
    _compute_active_repos_ma,
    _compute_runs_stats,
    _compute_free_to_paid_conversion,
    _compute_account_counts,
    _compute_churn,
    _compute_viral_coefficient,
    _compute_net_revenue_cents,
    compute_daily_kpi,
)


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture
def snapshot() -> date:
    """Return a fixed snapshot date for repeatable tests."""
    return date(2026, 6, 24)


@pytest.fixture
def mock_cursor() -> MagicMock:
    """Return a MagicMock that simulates a DB cursor."""
    cursor = MagicMock()
    cursor.fetchone.return_value = (0,)
    cursor.fetchall.return_value = []
    return cursor


@pytest.fixture
def mock_conn(mock_cursor: MagicMock) -> MagicMock:
    """Return a MagicMock that simulates a DB connection."""
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = mock_cursor
    conn.cursor.return_value = mock_cursor
    return conn


# ===========================================================================
# Unit tests for individual KPI computation functions
# ===========================================================================


class TestComputeActiveReposMa:
    def test_returns_zero_when_no_data(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (0,)
        result = _compute_active_repos_ma(mock_cursor, date(2026, 6, 24))
        assert result == 0

    def test_returns_repo_count(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (5,)
        result = _compute_active_repos_ma(mock_cursor, date(2026, 6, 24))
        assert result == 5

    def test_passes_correct_date_range(self, mock_cursor: MagicMock) -> None:
        snap = date(2026, 6, 24)
        _compute_active_repos_ma(mock_cursor, snap)
        thirty_days_ago = snap - timedelta(days=30)
        expected_end = snap + timedelta(days=1)
        call_args = mock_cursor.execute.call_args
        assert call_args is not None
        assert call_args[0][1] == (thirty_days_ago, expected_end)


class TestComputeRunsStats:
    def test_returns_zero_counts(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (0, 0, 0)
        result = _compute_runs_stats(mock_cursor, date(2026, 6, 24))
        assert result == {"total": 0, "successful": 0, "failed": 0}

    def test_returns_mixed_counts(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (10, 7, 2)
        result = _compute_runs_stats(mock_cursor, date(2026, 6, 24))
        assert result == {"total": 10, "successful": 7, "failed": 2}

    def test_passes_date_range(self, mock_cursor: MagicMock) -> None:
        snap = date(2026, 6, 24)
        _compute_runs_stats(mock_cursor, snap)
        call_args = mock_cursor.execute.call_args
        assert call_args is not None
        assert call_args[0][1] == (snap, snap + timedelta(days=1))


class TestComputeFreeToPaidConversion:
    def test_returns_zero(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (0,)
        result = _compute_free_to_paid_conversion(mock_cursor, date(2026, 6, 24))
        assert result == 0

    def test_returns_conversion_count(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (3,)
        result = _compute_free_to_paid_conversion(mock_cursor, date(2026, 6, 24))
        assert result == 3


class TestComputeAccountCounts:
    def test_returns_zeros(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (0, 0)
        result = _compute_account_counts(mock_cursor)
        assert result == {"free": 0, "paid": 0}

    def test_returns_counts(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (50, 10)
        result = _compute_account_counts(mock_cursor)
        assert result == {"free": 50, "paid": 10}


class TestComputeChurn:
    def test_returns_zero_churn(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.side_effect = [(0,), (5,)]
        result = _compute_churn(mock_cursor, date(2026, 6, 24))
        assert result == {"churned": 0, "paid": 5}

    def test_returns_churned_and_paid(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.side_effect = [(2,), (10,)]
        result = _compute_churn(mock_cursor, date(2026, 6, 24))
        assert result == {"churned": 2, "paid": 10}


class TestComputeViralCoefficient:
    def test_returns_zeros(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (0,)
        result = _compute_viral_coefficient(mock_cursor, date(2026, 6, 24))
        assert result == {"referred": 0, "total_new": 0}

    def test_returns_new_account_count(self, mock_cursor: MagicMock) -> None:
        mock_cursor.fetchone.return_value = (15,)
        result = _compute_viral_coefficient(mock_cursor, date(2026, 6, 24))
        assert result == {"referred": 0, "total_new": 15}


class TestComputeNetRevenueCents:
    def test_returns_zero_for_no_paid(self) -> None:
        result = _compute_net_revenue_cents(0, date(2026, 6, 24))
        assert result == 0

    def test_uses_env_var(self) -> None:
        with patch.dict(os.environ, {"KPI_AVG_REVENUE_PER_ACCOUNT_CENTS": "9999"}, clear=False):
            result = _compute_net_revenue_cents(10, date(2026, 6, 24))
            assert result == 99990

    def test_defaults_to_4900_cents(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            # Re-import to pick up default
            import importlib
            from workers.tasks import kpi_etl as kpi_module
            importlib.reload(kpi_module)
            result = kpi_module._compute_net_revenue_cents(10, date(2026, 6, 24))
            assert result == 49000


# ===========================================================================
# Integration tests for compute_daily_kpi
# ===========================================================================


class TestComputeDailyKpi:
    def test_calls_all_computations(self) -> None:
        """Verify the ETL task calls each computation and upserts the result."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()

        # Each query returns plausible data
        mock_cursor.fetchone.side_effect = [
            (7,),     # active_repos_ma
            (20, 15, 3),  # runs_stats (total, successful, failed)
            (2,),     # free_to_paid_conversion
            (80, 12), # account_counts (free, paid)
            (1,),     # churn count
            (12,),    # paid account count for churn denominator
            (5,),     # viral coefficient (new accounts)
        ]
        mock_conn.cursor.return_value = mock_cursor

        with (
            patch(
                "workers.tasks.kpi_etl._get_conn",
                return_value=mock_conn,
            ),
            patch.dict(
                os.environ,
                {"KPI_AVG_REVENUE_PER_ACCOUNT_CENTS": "5000"},
                clear=False,
            ),
        ):
            result = compute_daily_kpi(target_date="2026-06-24")

        # Verify the result contains all expected keys
        assert result["snapshot_date"] == "2026-06-24"
        assert result["active_repos_ma"] == 7
        assert result["total_runs"] == 20
        assert result["successful_runs"] == 15
        assert result["failed_runs"] == 3
        assert result["free_accounts"] == 80
        assert result["paid_accounts"] == 12
        assert result["free_to_paid_conversion"] == 2
        assert result["net_revenue_cents"] == 60000   # 12 * 5000
        assert result["churned_accounts"] == 1
        assert result["referred_accounts"] == 0
        assert result["total_new_accounts"] == 5

        # Verify upsert SQL was executed
        upsert_call = None
        for call in mock_cursor.execute.call_args_list:
            if call[0][0].startswith("INSERT INTO kpi_metrics"):
                upsert_call = call
                break
        assert upsert_call is not None, "Expected upsert SQL to be executed"
        assert upsert_call[0][1]["snapshot_date"] == "2026-06-24"

        # Verify commit was called
        mock_conn.commit.assert_called_once()

    def test_rollback_on_error(self) -> None:
        """Verify rollback is called when an exception occurs."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = Exception("DB error")
        mock_conn.cursor.return_value = mock_cursor

        task_instance = MagicMock()
        task_instance.retry.side_effect = Exception("Retry triggered")

        with (
            patch(
                "workers.tasks.kpi_etl._get_conn",
                return_value=mock_conn,
            ),
            pytest.raises(Exception, match="Retry triggered"),
        ):
            compute_daily_kpi(target_date="2026-06-24")

        mock_conn.rollback.assert_called_once()

    def test_uses_yesterday_when_no_target(self) -> None:
        """Verify the task defaults to yesterday when no target_date is given."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [
            (0,),     # active_repos_ma
            (0, 0, 0),  # runs_stats
            (0,),     # conversion
            (0, 0),   # accounts
            (0,),     # churn
            (0,),     # paid count
            (0,),     # new accounts
        ]
        mock_conn.cursor.return_value = mock_cursor

        with patch(
            "workers.tasks.kpi_etl._get_conn",
            return_value=mock_conn,
        ):
            result = compute_daily_kpi()

        expected_snapshot = date.today() - timedelta(days=1)
        assert result["snapshot_date"] == expected_snapshot.isoformat()

    def test_completion_rate_rounding(self) -> None:
        """Verify fix_completion_rate is rounded to 4 decimal places."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [
            (0,),     # active_repos_ma
            (3, 1, 1),  # runs_stats (total, successful, failed) → rate = 0.3333...
            (0,),     # conversion
            (0, 0),   # accounts
            (0,),     # churn
            (0,),     # paid count
            (0,),     # new accounts
        ]
        mock_conn.cursor.return_value = mock_cursor

        with patch(
            "workers.tasks.kpi_etl._get_conn",
            return_value=mock_conn,
        ):
            result = compute_daily_kpi(target_date="2026-06-24")

        assert result["fix_completion_rate"] == 0.3333

    def test_avoids_division_by_zero(self) -> None:
        """Verify no ZeroDivisionError when there are no runs or accounts."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [
            (0,),     # active_repos_ma
            (0, 0, 0),  # runs_stats
            (0,),     # conversion
            (0, 0),   # accounts
            (0,),     # churn
            (0,),     # paid count
            (0,),     # new accounts
        ]
        mock_conn.cursor.return_value = mock_cursor

        with patch(
            "workers.tasks.kpi_etl._get_conn",
            return_value=mock_conn,
        ):
            result = compute_daily_kpi(target_date="2026-06-24")

        assert result["fix_completion_rate"] == 0
        assert result["churn_rate"] == 0
        assert result["viral_coefficient"] == 0
        assert result["net_revenue_cents"] == 0


# ===========================================================================
# Edge cases
# ===========================================================================


class TestEdgeCases:
    def test_database_connection_failure(self) -> None:
        """Verify the task retries when the DB connection fails."""
        with (
            patch(
                "workers.tasks.kpi_etl._get_conn",
                side_effect=Exception("Connection refused"),
            ),
            pytest.raises(Exception, match="Connection refused"),
        ):
            compute_daily_kpi(target_date="2026-06-24")

    def test_empty_database_returns_zero_counts(self) -> None:
        """Verify the ETL handles an empty database gracefully."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (0,)
        mock_conn.cursor.return_value = mock_cursor

        with patch(
            "workers.tasks.kpi_etl._get_conn",
            return_value=mock_conn,
        ):
            result = compute_daily_kpi(target_date="2026-06-24")

        # All numeric fields should be zero
        for key in [
            "active_repos_ma", "total_runs", "successful_runs",
            "failed_runs", "free_accounts", "paid_accounts",
            "free_to_paid_conversion", "churned_accounts",
            "referred_accounts", "total_new_accounts",
        ]:
            assert result[key] == 0, f"Expected {key} to be 0, got {result[key]}"

        assert result["fix_completion_rate"] == 0
        assert result["churn_rate"] == 0
        assert result["viral_coefficient"] == 0
        assert result["net_revenue_cents"] == 0
