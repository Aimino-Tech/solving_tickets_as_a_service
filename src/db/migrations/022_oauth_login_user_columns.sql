-- OAuth/SaaS auth: users table must carry plan/billing columns that
-- register + OAuth upsert paths write. 005_multi_tenant ran before 013
-- created users, so these were never added. Self-hosted safety: IF NOT EXISTS.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

COMMIT;
