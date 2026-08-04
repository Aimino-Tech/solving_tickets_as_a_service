-- Role-based access control for the users table.
-- Mirrors the plan-sync pattern (DB column + Supabase Auth app_metadata.role).
-- Self-hosted safety: ALL operations use IF NOT EXISTS patterns.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

COMMIT;
