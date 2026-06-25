-- AIM-2002: Agent Performance Analytics -- fix rate, cost, time per task type
-- Migration: 010_agent_analytics

BEGIN;

CREATE TABLE IF NOT EXISTS agent_analytics_runs (
    id                SERIAL PRIMARY KEY,
    run_id            VARCHAR(64) NOT NULL UNIQUE,
    tenant_id         VARCHAR(64) NOT NULL DEFAULT '',
    model             VARCHAR(128) NOT NULL DEFAULT '',
    task_type         VARCHAR(64) NOT NULL DEFAULT '',
    tokens_prompt     INTEGER NOT NULL DEFAULT 0,
    tokens_completion INTEGER NOT NULL DEFAULT 0,
    tokens_total      INTEGER NOT NULL DEFAULT 0,
    cost_cents        INTEGER NOT NULL DEFAULT 0,
    duration_ms       INTEGER NOT NULL DEFAULT 0,
    fix_success       BOOLEAN NOT NULL DEFAULT FALSE,
    error_message     TEXT NOT NULL DEFAULT '',
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_runs_model
    ON agent_analytics_runs(model);
CREATE INDEX IF NOT EXISTS idx_analytics_runs_task_type
    ON agent_analytics_runs(task_type);
CREATE INDEX IF NOT EXISTS idx_analytics_runs_synced_at
    ON agent_analytics_runs(synced_at);
CREATE INDEX IF NOT EXISTS idx_analytics_runs_tenant
    ON agent_analytics_runs(tenant_id);

CREATE TABLE IF NOT EXISTS agent_analytics_daily (
    id                SERIAL PRIMARY KEY,
    snapshot_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    task_type         VARCHAR(64) NOT NULL DEFAULT '',
    model             VARCHAR(128) NOT NULL DEFAULT '',
    total_runs        INTEGER NOT NULL DEFAULT 0,
    successful_runs   INTEGER NOT NULL DEFAULT 0,
    failed_runs       INTEGER NOT NULL DEFAULT 0,
    fix_rate          NUMERIC(5,4) NOT NULL DEFAULT 0,
    total_cost_cents  INTEGER NOT NULL DEFAULT 0,
    avg_cost_cents    NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_duration_ms BIGINT NOT NULL DEFAULT 0,
    avg_duration_ms   INTEGER NOT NULL DEFAULT 0,
    total_tokens      BIGINT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_unique
    ON agent_analytics_daily(snapshot_date, task_type, model);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_date
    ON agent_analytics_daily(snapshot_date DESC);

COMMIT;
