-- Enrich audit_logs with new fields for comprehensive audit trail
-- Migration: 002_audit_logs_enrich
-- 
-- Adds: timestamp, actor_type, actor_id, resource_type, resource_id,
--       details (JSONB), user_agent, correlation_id
-- Replaces: account_id → actor_id + actor_type, details TEXT → JSONB, ip_address INET → VARCHAR

-- Step 1: Add new columns with defaults
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'system';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(50);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details_jsonb JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255);

-- Step 2: Migrate existing data
-- Copy account_id values to actor_id and set actor_type='user' for existing rows
UPDATE audit_logs SET
  actor_id = account_id::VARCHAR,
  actor_type = 'user',
  details_jsonb = CASE
    WHEN details IS NOT NULL THEN
      CASE
        WHEN details::text ~ '^\{.*\}$' THEN details::jsonb
        ELSE jsonb_build_object('description', details)
      END
    ELSE NULL
  END,
  timestamp = created_at
WHERE actor_id IS NULL;

-- Step 3: Drop old columns (after migration)
ALTER TABLE audit_logs DROP COLUMN IF EXISTS account_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS details;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS ip_address; -- Replaced by ip_address in new format
ALTER TABLE audit_logs DROP COLUMN IF EXISTS created_at; -- Replaced by timestamp

-- Step 4: Migrate ip_address from INET to VARCHAR (if the column was removed and re-added)
-- Note: ip_address column already exists as VARCHAR(45) in new schema

-- Step 5: Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_type ON audit_logs(actor_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON audit_logs(correlation_id);
