-- Rollback: Restore original audit_logs schema
-- Migration: 002_audit_logs_enrich

-- Step 1: Re-add old columns
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 2: Restore data from new columns
UPDATE audit_logs SET
  account_id = CASE
    WHEN actor_type = 'user' AND actor_id ~ '^\d+$' THEN actor_id::INTEGER
    ELSE NULL
  END,
  details = CASE
    WHEN details_jsonb IS NOT NULL THEN details_jsonb::text
    ELSE NULL
  END,
  created_at = timestamp
WHERE account_id IS NULL;

-- Step 3: Drop new columns
ALTER TABLE audit_logs DROP COLUMN IF EXISTS timestamp;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_type;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS resource_type;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS resource_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS details_jsonb;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS user_agent;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS ip_address; -- Drop the new varchar ip_address

-- Step 4: Drop new indexes
DROP INDEX IF EXISTS idx_audit_logs_timestamp;
DROP INDEX IF EXISTS idx_audit_logs_actor_type;
DROP INDEX IF EXISTS idx_audit_logs_actor_id;
DROP INDEX IF EXISTS idx_audit_logs_action;
DROP INDEX IF EXISTS idx_audit_logs_resource;
DROP INDEX IF EXISTS idx_audit_logs_correlation;
