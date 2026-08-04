-- User identity (Supabase Auth UUID = users.id)
-- Canonical user-domain DDL. Idempotent for fresh + existing DBs.
--
-- NOTE: password_hash may be a placeholder for OAuth-only users.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                VARCHAR(255) UNIQUE NOT NULL,
    password_hash        VARCHAR(255) NOT NULL DEFAULT '',
    name                 VARCHAR(255),
    plan                 VARCHAR(50) NOT NULL DEFAULT 'free',
    trial_start          TIMESTAMPTZ,
    trial_end            TIMESTAMPTZ,
    stripe_customer_id   VARCHAR(255),
    subscription_status  VARCHAR(50) NOT NULL DEFAULT 'inactive',
    subscription_id      VARCHAR(255),
    role                 VARCHAR(50) NOT NULL DEFAULT 'user',
    referral_code        TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Promote legacy SERIAL users → UUID when still on the old shape
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'id' AND data_type IN ('integer', 'bigint')
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'supabase_uid'
    ) THEN
      ALTER TABLE users ADD COLUMN supabase_uid VARCHAR(255) UNIQUE;
    END IF;
    UPDATE users SET supabase_uid = gen_random_uuid()::text WHERE supabase_uid IS NULL;
    ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN id TYPE UUID USING supabase_uid::uuid;
    ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE users DROP COLUMN IF EXISTS supabase_uid;
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

COMMIT;
