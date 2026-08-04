-- Role-based access control for users (idempotent; also covered by 013_users).
-- Mirrors Supabase Auth app_metadata.role.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

COMMIT;
