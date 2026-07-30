-- AIM-3876: Add user_id FK to accounts and billing tables.
-- Links GitHub installation accounts and billing records to users table
-- for SaaS email/password auth path.
--
-- Self-hosted safety: ALL operations use IF NOT EXISTS / IF EXISTS patterns.

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE billing ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_user_id ON billing(user_id);

COMMIT;
