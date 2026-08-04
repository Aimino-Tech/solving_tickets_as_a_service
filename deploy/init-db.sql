-- Database initialization script for SYNTARO production deployment.
-- Run this as a PostgreSQL superuser (e.g., postgres) to set up the
-- application database user with proper permissions.

-- Create the application database (if using a separate DB)
-- CREATE DATABASE syntaro;

-- Create the application user (if not already exists)
-- Replace 'syntaro_user' and 'syntaro_password' with your actual credentials
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'syntaro_user') THEN
--     CREATE ROLE syntaro_user WITH LOGIN PASSWORD 'syntaro_password';
--   END IF;
-- END
-- $$;

-- Grant schema-level permissions
GRANT USAGE ON SCHEMA public TO syntaro_user;
GRANT CREATE ON SCHEMA public TO syntaro_user;

-- Grant table-level permissions (for existing and future tables)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO syntaro_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO syntaro_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO syntaro_user;

-- Grant all on the database for migration operations
GRANT ALL PRIVILEGES ON DATABASE syntaro TO syntaro_user;

-- For pg_stat_statements (used by health checks)
GRANT pg_read_all_stats TO syntaro_user;

-- Note: In production, you may want to restrict to only:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO syntaro_user;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO syntaro_user;
-- But migrations require CREATE TABLE which needs CREATE on schema.
