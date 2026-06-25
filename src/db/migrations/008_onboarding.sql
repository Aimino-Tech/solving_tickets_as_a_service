-- Onboarding automation schema
-- Migration: 008_onboarding
--
-- Adds tables for the self-service onboarding flow:
--   onboarding_state   — tracks current state per tenant (state machine persistence)
--   tenant_repos       — repository whitelist with label configuration
--   billing.linear_access_token — encrypted OAuth token for Linear

-- ============================================================================
-- 1. Onboarding state machine table
-- ============================================================================
CREATE TABLE IF NOT EXISTS onboarding_state (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL UNIQUE,
    state VARCHAR(50) NOT NULL DEFAULT 'not_started',
    progress_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_state_tenant ON onboarding_state(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_state_state ON onboarding_state(state);

-- ============================================================================
-- 2. Tenant repos table — per-tenant repository whitelist with labels
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_repos (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    owner VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    installation_id INTEGER NOT NULL,
    labels TEXT[] NOT NULL DEFAULT '{stas:fix}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, owner, name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_repos_tenant ON tenant_repos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_repos_installation ON tenant_repos(installation_id);
CREATE INDEX IF NOT EXISTS idx_tenant_repos_owner_name ON tenant_repos(owner, name);

-- ============================================================================
-- 3. Add linear_access_token to billing table
-- ============================================================================
ALTER TABLE billing
  ADD COLUMN IF NOT EXISTS linear_access_token TEXT,
  ADD COLUMN IF NOT EXISTS linear_organization_id VARCHAR(255);

-- ============================================================================
-- 4. Add repository whitelist and label config to accounts table
-- ============================================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS github_install_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS github_install_deleted_at TIMESTAMPTZ;
