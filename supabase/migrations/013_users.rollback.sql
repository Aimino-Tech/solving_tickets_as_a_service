-- Rollback 013_users — drop user identity table (destructive)
DROP TABLE IF EXISTS users CASCADE;
