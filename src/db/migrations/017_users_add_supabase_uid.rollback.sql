BEGIN;

DROP INDEX IF EXISTS idx_users_supabase_uid;

ALTER TABLE users DROP COLUMN IF EXISTS supabase_uid;

COMMIT;
