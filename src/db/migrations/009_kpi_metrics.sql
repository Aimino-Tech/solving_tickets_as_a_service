-- AIM-2080: KPI metrics table for internal KPI dashboard
-- Migration: 009_kpi_metrics
--
-- Creates:
--   kpi_metrics  — Daily snapshots of key business KPIs for internal dashboard
--
-- KPIs tracked per snapshot:
--   active_repos_ma         — Monthly active repos (repos with >=1 run in last 30 days)
--   fix_completion_rate     — Percentage of runs that succeeded
--   free_to_paid_conversion — Number of accounts that converted from free to paid
--   net_revenue_cents       — Net revenue in cents (Stripe)
--   churn_rate              — Accounts that cancelled / total paid accounts
--   viral_coefficient       — New accounts from referrals / total new accounts

BEGIN;

CREATE TABLE IF NOT EXISTS kpi_metrics (
    id                  SERIAL PRIMARY KEY,
    snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    active_repos_ma     INTEGER NOT NULL DEFAULT 0,
    fix_completion_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
    total_runs          INTEGER NOT NULL DEFAULT 0,
    successful_runs     INTEGER NOT NULL DEFAULT 0,
    failed_runs         INTEGER NOT NULL DEFAULT 0,
    free_accounts       INTEGER NOT NULL DEFAULT 0,
    paid_accounts       INTEGER NOT NULL DEFAULT 0,
    free_to_paid_conversion INTEGER NOT NULL DEFAULT 0,
    net_revenue_cents   BIGINT NOT NULL DEFAULT 0,
    churn_rate          NUMERIC(5,4) NOT NULL DEFAULT 0,
    churned_accounts    INTEGER NOT NULL DEFAULT 0,
    viral_coefficient   NUMERIC(5,4) NOT NULL DEFAULT 0,
    referred_accounts   INTEGER NOT NULL DEFAULT 0,
    total_new_accounts  INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_metrics_snapshot_date
    ON kpi_metrics(snapshot_date DESC);

COMMIT;
