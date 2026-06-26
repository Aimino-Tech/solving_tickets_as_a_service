-- AIM-1999: Pipeline Run History — persistent analytics + search
-- Migration: 011_pipeline_run_history
--
-- Creates:
--   pipeline_stage_events  — Individual stage events within a pipeline run
--   pipeline_runs          — Top-level pipeline run records with aggregated stage info
--
-- Retention: pipeline_runs auto-purged after 90 days via enforce_retention()
-- Tenant isolation via tenant_id on every row

BEGIN;

-- ---------------------------------------------------------------------------
-- pipeline_runs: top-level run record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              SERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL DEFAULT '',
    issue_id        VARCHAR(128) NOT NULL DEFAULT '',
    status          VARCHAR(32) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed','cancelled')),
    agent_type      VARCHAR(64) NOT NULL DEFAULT '',
    stages          JSONB NOT NULL DEFAULT '[]'::jsonb,
    error           TEXT NOT NULL DEFAULT '',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant
    ON pipeline_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
    ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at
    ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_status
    ON pipeline_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_created
    ON pipeline_runs(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- pipeline_stage_events: individual stage events within a run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_stage_events (
    id              SERIAL PRIMARY KEY,
    run_id          INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    tenant_id       VARCHAR(64) NOT NULL DEFAULT '',
    stage_name      VARCHAR(128) NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','completed','failed','skipped')),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    output          TEXT NOT NULL DEFAULT '',
    error           TEXT NOT NULL DEFAULT '',
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_events_run
    ON pipeline_stage_events(run_id);
CREATE INDEX IF NOT EXISTS idx_stage_events_tenant
    ON pipeline_stage_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stage_events_stage
    ON pipeline_stage_events(stage_name);

COMMIT;
