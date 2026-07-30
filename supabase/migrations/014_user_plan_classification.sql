-- Plan classification columns for the users table.
-- Self-hosted safety: ALL operations use IF NOT EXISTS / IF EXISTS patterns.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

COMMIT;
