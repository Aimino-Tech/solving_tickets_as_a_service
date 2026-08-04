-- AIM-4631: Monitoring-induced incidents — first-class tracking
-- Migration: 024_incidents
--
-- Incidents are created by the OS monitoring pipeline (webhook → incident).
-- This table stores the incident state (SEV, status, source, confidence gate),
-- a timeline of status transitions, and per-repo fix links for cross-repo
-- incidents. The service catalog maps a service to its repositories so the
-- webapp can pick services (→ repos) when creating incidents.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. incidents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
    id                 SERIAL PRIMARY KEY,
    title              TEXT NOT NULL,
    severity           TEXT NOT NULL DEFAULT 'SEV3',
    status             TEXT NOT NULL DEFAULT 'open',
    source             TEXT NOT NULL DEFAULT 'monitoring',
    confidence         TEXT,
    summary            TEXT,
    alert_id           TEXT,
    run_id             TEXT,
    auto_fixed         BOOLEAN NOT NULL DEFAULT FALSE,
    policy_decision    TEXT,
    resolved_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status      ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity    ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at  ON incidents(created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. incident_timeline — alert → investigating → fixing → PR → resolved
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_timeline (
    id           SERIAL PRIMARY KEY,
    incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    event        TEXT NOT NULL,
    detail       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident
  ON incident_timeline(incident_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. incident_repos — linked repos + draft PRs (multi-repo batch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_repos (
    id           SERIAL PRIMARY KEY,
    incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    repo_owner   TEXT NOT NULL,
    repo_name    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    pr_url       TEXT,
    branch_name  TEXT,
    run_id       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_repos_incident
  ON incident_repos(incident_id);

-- ---------------------------------------------------------------------------
-- 4. service_catalog — service → repo(s) mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_catalog (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    purpose      TEXT,
    repos        JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
