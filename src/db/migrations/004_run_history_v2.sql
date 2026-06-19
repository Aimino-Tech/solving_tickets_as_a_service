-- AIM-1203: Upgrade run_history table to storage-compatible schema.
-- Renames the original table to run_history_legacy and creates a new
-- run_history table with the columns expected by the StorageBackend.
--
-- The legacy table is kept so admin queries that reference it can be
-- updated at leisure.

BEGIN;

-- -----------------------------------------------------------------------
-- 1. Rename the existing table
-- -----------------------------------------------------------------------
ALTER TABLE IF EXISTS run_history RENAME TO run_history_legacy;

-- -----------------------------------------------------------------------
-- 2. Create the new run_history table (storage-compatible schema)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_history (
    id              SERIAL PRIMARY KEY,
    installation_id INTEGER NOT NULL,
    repo_owner      TEXT NOT NULL,
    repo_name       TEXT NOT NULL,
    issue_number    INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    confidence      TEXT,
    summary         TEXT,
    pr_url          TEXT,
    branch_name     TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms     INTEGER,
    model_used      TEXT
);

-- -----------------------------------------------------------------------
-- 3. Copy data from legacy table (column mapping)
-- -----------------------------------------------------------------------
INSERT INTO run_history (
    id,
    installation_id,
    repo_owner,
    repo_name,
    issue_number,
    status,
    created_at,
    updated_at,
    duration_ms
)
SELECT
    id,
    COALESCE(account_id, 0),
    COALESCE(SPLIT_PART(COALESCE(repo, '/'), '/', 1), 'unknown'),
    COALESCE(SPLIT_PART(COALESCE(repo, '/'), '/', 2), 'unknown'),
    COALESCE(issue_id, 0),
    status,
    COALESCE(started_at, NOW()),
    COALESCE(completed_at, NOW()),
    CASE
        WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (completed_at - started_at))::integer * 1000
        ELSE NULL
    END
FROM run_history_legacy;

-- -----------------------------------------------------------------------
-- 4. Indexes for common query patterns
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_run_history_installation   ON run_history(installation_id);
CREATE INDEX IF NOT EXISTS idx_run_history_repo           ON run_history(repo_owner, repo_name);
CREATE INDEX IF NOT EXISTS idx_run_history_status         ON run_history(status);
CREATE INDEX IF NOT EXISTS idx_run_history_created_at     ON run_history(created_at DESC);

COMMIT;
