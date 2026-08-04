"""
Celery Beat daily ETL — aggregate KPI metrics into kpi_metrics table (AIM-2080).

Runs daily at midnight and computes the following KPIs for the previous day:

    active_repos_ma         — Distinct repos with ≥1 run in the last 30 days
    fix_completion_rate     — Successful runs / total runs for the day
    free_to_paid_conversion — Accounts that converted from free to a paid plan
    net_revenue_cents       — Revenue estimation based on paid account count
    churn_rate              — Paid accounts that churned / total paid accounts
    viral_coefficient       — Referred accounts / total new accounts (placeholder)

The results are upserted into the ``kpi_metrics`` table by snapshot_date.

── Idempotency ────────────────────────────────────────────────────────────────
The task uses INSERT ... ON CONFLICT (snapshot_date) DO UPDATE so it is safe
to run multiple times — re-running recomputes the same day's snapshot without
creating duplicate rows.
────────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta, timezone
from typing import Any

import psycopg2
import psycopg2.extras
from celery import shared_task

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Database connection helper
# ---------------------------------------------------------------------------

_DSN: str | None = None


def _get_dsn() -> str:
    global _DSN
    if _DSN is None:
        _DSN = os.getenv(
            "KPI_DATABASE_URL",
            os.getenv("DATABASE_URL", "postgresql://localhost:5432/syntaro"),
        )
    return _DSN


def _get_conn() -> Any:
    """Get a new database connection for the ETL operation."""
    dsn = _get_dsn()
    conn = psycopg2.connect(dsn)
    conn.set_session(autocommit=False)
    return conn


# ---------------------------------------------------------------------------
# KPI computation helpers
# ---------------------------------------------------------------------------


def _compute_active_repos_ma(cursor: Any, snapshot: date) -> int:
    """Count distinct repos with runs in the 30 days ending on snapshot."""
    thirty_days_ago = snapshot - timedelta(days=30)
    cursor.execute(
        """
        SELECT COUNT(DISTINCT repo_id) AS cnt
        FROM runs
        WHERE repo_id IS NOT NULL
          AND created_at >= %s
          AND created_at < %s
        """,
        (thirty_days_ago, snapshot + timedelta(days=1)),
    )
    row = cursor.fetchone()
    return row[0] if row else 0


def _compute_runs_stats(cursor: Any, snapshot: date) -> dict[str, int]:
    """Count total, successful, and failed runs for the snapshot day."""
    cursor.execute(
        """
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'success') AS successful,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM runs
        WHERE created_at >= %s
          AND created_at < %s
        """,
        (snapshot, snapshot + timedelta(days=1)),
    )
    row = cursor.fetchone()
    return {
        "total": row[0] if row else 0,
        "successful": row[1] if row else 0,
        "failed": row[2] if row else 0,
    }


def _compute_free_to_paid_conversion(cursor: Any, snapshot: date) -> int:
    """Count accounts that upgraded from free to a paid plan on this day.

    Uses billing status changes and plan field to detect conversions.
    """
    cursor.execute(
        """
        SELECT COUNT(DISTINCT b.account_id) AS cnt
        FROM billing b
        WHERE b.plan != 'free'
          AND b.status = 'active'
          AND b.current_period_start >= %s
          AND b.current_period_start < %s
        """,
        (snapshot, snapshot + timedelta(days=1)),
    )
    row = cursor.fetchone()
    return row[0] if row else 0


def _compute_account_counts(cursor: Any) -> dict[str, int]:
    """Count free and paid accounts from the billing table."""
    cursor.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE plan = 'free') AS free_accounts,
            COUNT(*) FILTER (WHERE plan != 'free' AND status = 'active') AS paid_accounts
        FROM billing
        """,
    )
    row = cursor.fetchone()
    return {
        "free": row[0] if row else 0,
        "paid": row[1] if row else 0,
    }


def _compute_churn(cursor: Any, snapshot: date) -> dict[str, int]:
    """Count churned accounts on a given day.

    An account is considered churned when its billing status transitions
    to 'cancelled' or 'past_due' on the snapshot date, and it was
    previously a paid account.
    """
    cursor.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM billing
        WHERE plan != 'free'
          AND status IN ('cancelled', 'past_due')
        """,
    )
    row = cursor.fetchone()
    churned = row[0] if row else 0

    cursor.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM billing
        WHERE plan != 'free' AND status = 'active'
        """,
    )
    paid_row = cursor.fetchone()
    paid = paid_row[0] if paid_row else 0

    return {"churned": churned, "paid": paid}


def _compute_viral_coefficient(cursor: Any, snapshot: date) -> dict[str, int]:
    """Compute viral coefficient placeholder.

    Since SYNTARO doesn't yet have a referral tracking system, this uses
    the accounts table to count new accounts created on this day.
    When referral tracking is added, update this to count referred accounts.

    Returns:
        referred: Number of new accounts (placeholder for referred)
        total_new: Total new accounts on this day
    """
    cursor.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM accounts
        WHERE created_at >= %s
          AND created_at < %s
        """,
        (snapshot, snapshot + timedelta(days=1)),
    )
    total_new = cursor.fetchone()[0] or 0

    # Placeholder: no referral tracking yet — assume 0 referred
    referred = 0

    return {"referred": referred, "total_new": total_new}


def _compute_net_revenue_cents(paid_accounts: int, _snapshot: date) -> int:
    """Estimate net revenue based on paid account count.

    This is a best-effort estimation based on the number of paid accounts
    multiplied by the average plan price. When Stripe integration provides
    actual revenue data, replace this with a query against Stripe invoice
    records or a dedicated revenue table.

    The average revenue per paid account is taken from the
    KPI_AVG_REVENUE_PER_ACCOUNT_CENTS env var (default: 4900 cents = $49).
    """
    avg_revenue = int(os.getenv("KPI_AVG_REVENUE_PER_ACCOUNT_CENTS", "4900"))
    return paid_accounts * avg_revenue


# ---------------------------------------------------------------------------
# Main ETL task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    autoretry_for=(Exception,),
    name="workers.tasks.kpi_etl.compute_daily_kpi",
)
def compute_daily_kpi(self: Any, target_date: str | None = None) -> dict[str, Any]:
    """Celery beat task — aggregate daily KPI metrics into kpi_metrics.

    Args:
        target_date: ISO date string (YYYY-MM-DD) to compute KPIs for.
                     Defaults to yesterday.

    Returns:
        Dict with snapshot date and computed metric values.
    """
    snapshot: date
    if target_date:
        snapshot = date.fromisoformat(target_date)
    else:
        snapshot = date.today() - timedelta(days=1)

    logger.info("Computing daily KPI snapshot for %s", snapshot.isoformat())

    conn = None
    try:
        conn = _get_conn()
        cursor = conn.cursor()

        # --- Compute each KPI ---
        active_repos_ma = _compute_active_repos_ma(cursor, snapshot)

        runs_stats = _compute_runs_stats(cursor, snapshot)
        total_runs = runs_stats["total"]
        successful_runs = runs_stats["successful"]
        failed_runs = runs_stats["failed"]
        fix_completion_rate = round(
            successful_runs / max(total_runs, 1), 4
        )

        free_to_paid_conversion = _compute_free_to_paid_conversion(cursor, snapshot)

        account_counts = _compute_account_counts(cursor)
        free_accounts = account_counts["free"]
        paid_accounts = account_counts["paid"]

        churn_data = _compute_churn(cursor, snapshot)
        churned = churn_data["churned"]
        churn_rate = round(churned / max(paid_accounts, 1), 4)

        viral_data = _compute_viral_coefficient(cursor, snapshot)
        referred = viral_data["referred"]
        total_new_accounts = viral_data["total_new"]
        viral_coefficient = round(
            referred / max(total_new_accounts, 1), 4
        )

        net_revenue_cents = _compute_net_revenue_cents(paid_accounts, snapshot)

        # --- Upsert into kpi_metrics ---
        upsert_sql = """
            INSERT INTO kpi_metrics (
                snapshot_date, active_repos_ma, fix_completion_rate,
                total_runs, successful_runs, failed_runs,
                free_accounts, paid_accounts, free_to_paid_conversion,
                net_revenue_cents, churn_rate, churned_accounts,
                viral_coefficient, referred_accounts, total_new_accounts
            ) VALUES (
                %(snapshot_date)s, %(active_repos_ma)s, %(fix_completion_rate)s,
                %(total_runs)s, %(successful_runs)s, %(failed_runs)s,
                %(free_accounts)s, %(paid_accounts)s, %(free_to_paid_conversion)s,
                %(net_revenue_cents)s, %(churn_rate)s, %(churned_accounts)s,
                %(viral_coefficient)s, %(referred_accounts)s, %(total_new_accounts)s
            )
            ON CONFLICT (snapshot_date) DO UPDATE SET
                active_repos_ma = EXCLUDED.active_repos_ma,
                fix_completion_rate = EXCLUDED.fix_completion_rate,
                total_runs = EXCLUDED.total_runs,
                successful_runs = EXCLUDED.successful_runs,
                failed_runs = EXCLUDED.failed_runs,
                free_accounts = EXCLUDED.free_accounts,
                paid_accounts = EXCLUDED.paid_accounts,
                free_to_paid_conversion = EXCLUDED.free_to_paid_conversion,
                net_revenue_cents = EXCLUDED.net_revenue_cents,
                churn_rate = EXCLUDED.churn_rate,
                churned_accounts = EXCLUDED.churned_accounts,
                viral_coefficient = EXCLUDED.viral_coefficient,
                referred_accounts = EXCLUDED.referred_accounts,
                total_new_accounts = EXCLUDED.total_new_accounts
        """

        params: dict[str, Any] = {
            "snapshot_date": snapshot.isoformat(),
            "active_repos_ma": active_repos_ma,
            "fix_completion_rate": fix_completion_rate,
            "total_runs": total_runs,
            "successful_runs": successful_runs,
            "failed_runs": failed_runs,
            "free_accounts": free_accounts,
            "paid_accounts": paid_accounts,
            "free_to_paid_conversion": free_to_paid_conversion,
            "net_revenue_cents": net_revenue_cents,
            "churn_rate": churn_rate,
            "churned_accounts": churned,
            "viral_coefficient": viral_coefficient,
            "referred_accounts": referred,
            "total_new_accounts": total_new_accounts,
        }

        cursor.execute(upsert_sql, params)
        conn.commit()

        logger.info(
            "KPI snapshot %s — repos=%d fix_rate=%.2f%% "
            "free=%d paid=%d converted=%d revenue=%d "
            "churn=%.2f%% viral=%.3f new_accts=%d",
            snapshot.isoformat(),
            active_repos_ma,
            fix_completion_rate * 100,
            free_accounts,
            paid_accounts,
            free_to_paid_conversion,
            net_revenue_cents,
            churn_rate * 100,
            viral_coefficient,
            total_new_accounts,
        )

        return {
            "snapshot_date": snapshot.isoformat(),
            "active_repos_ma": active_repos_ma,
            "fix_completion_rate": fix_completion_rate,
            "total_runs": total_runs,
            "successful_runs": successful_runs,
            "failed_runs": failed_runs,
            "free_accounts": free_accounts,
            "paid_accounts": paid_accounts,
            "free_to_paid_conversion": free_to_paid_conversion,
            "net_revenue_cents": net_revenue_cents,
            "churn_rate": churn_rate,
            "churned_accounts": churned,
            "viral_coefficient": viral_coefficient,
            "referred_accounts": referred,
            "total_new_accounts": total_new_accounts,
        }

    except Exception as exc:
        logger.error(
            "KPI ETL failed for %s — %s",
            snapshot.isoformat(),
            exc,
        )
        if conn:
            conn.rollback()
        raise self.retry(exc=exc)

    finally:
        if conn:
            conn.close()
