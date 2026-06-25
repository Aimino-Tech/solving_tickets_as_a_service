-- AIM-1214: Add teams, repos, and billing tables for multi-tenant hosted service.
--
-- New tables:
--   teams       — Multi-tenant team management with account membership
--   repos       — Per-account repository tracking
--   billing     — Stripe subscription and usage tracking per account

BEGIN;

-- -----------------------------------------------------------------------
-- 1. Teams
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    account_ids     INTEGER[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

-- -----------------------------------------------------------------------
-- 2. Repos
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repos (
    id              SERIAL PRIMARY KEY,
    owner           VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    installation_id INTEGER NOT NULL,
    account_id      INTEGER NOT NULL,
    enabled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repos_account ON repos(account_id);
CREATE INDEX IF NOT EXISTS idx_repos_installation ON repos(installation_id);
CREATE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name);

-- -----------------------------------------------------------------------
-- 3. Billing
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing (
    id                      SERIAL PRIMARY KEY,
    account_id              INTEGER NOT NULL,
    stripe_customer_id      VARCHAR(255),
    stripe_subscription_id  VARCHAR(255),
    plan                    VARCHAR(50) NOT NULL DEFAULT 'free',
    status                  VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    usage_count             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_billing_account ON billing(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_stripe_customer ON billing(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_stripe_subscription ON billing(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_status ON billing(status);

COMMIT;
