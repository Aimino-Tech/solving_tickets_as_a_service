-- Multi-tenant schema: teams, repos, runs, billing, and extended accounts/audit_logs
-- Migration: 005_multi_tenant

BEGIN;

-- ============================================================================
-- 1. Extend accounts with multi-tenant fields
-- ============================================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS github_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS github_app_installation_id INTEGER,
  ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Backfill plan from tier for existing rows
UPDATE accounts SET plan = tier WHERE plan IS NULL OR plan = 'free';

-- ============================================================================
-- 2. Extend audit_logs with actor and target fields
-- ============================================================================
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor VARCHAR(255),
  ADD COLUMN IF NOT EXISTS target VARCHAR(255);

-- ============================================================================
-- 3. Teams table — account groupings for collaboration
-- ============================================================================
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    account_ids INTEGER[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_account_ids ON teams USING GIN(account_ids);

-- ============================================================================
-- 4. Repos table — tracked repositories per account
-- ============================================================================
CREATE TABLE IF NOT EXISTS repos (
    id SERIAL PRIMARY KEY,
    owner VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    installation_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repos_account ON repos(account_id);
CREATE INDEX IF NOT EXISTS idx_repos_installation ON repos(installation_id);
CREATE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name);

-- ============================================================================
-- 5. Runs table — detailed fix-run records with full metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    repo_id INTEGER REFERENCES repos(id) ON DELETE SET NULL,
    issue_number INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    confidence VARCHAR(20),
    summary TEXT,
    pr_url VARCHAR(500),
    branch_name VARCHAR(255),
    error TEXT,
    duration_ms INTEGER,
    model_used VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_account ON runs(account_id);
CREATE INDEX IF NOT EXISTS idx_runs_repo ON runs(repo_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

-- ============================================================================
-- 6. Billing table — subscription and usage tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS billing (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    plan VARCHAR(50) NOT NULL DEFAULT 'free',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    usage_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_billing_account ON billing(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_stripe_customer ON billing(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_plan ON billing(plan);

-- ============================================================================
-- 7. Update indexes on existing tables for new query patterns
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_accounts_plan ON accounts(plan);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(github_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target);

-- Add foreign key constraint on repos.account_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'repos_account_id_fkey'
    ) THEN
        ALTER TABLE repos ADD CONSTRAINT repos_account_id_fkey
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;
    END IF;
END $$;

COMMIT;
