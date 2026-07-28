BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_uid VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_supabase_uid ON users(supabase_uid);

COMMIT;
