-- Rollback AIM-1203: Restore the original run_history table.
--
-- Drops the new run_history table and renames the legacy table back.

BEGIN;

-- Drop indexes on the new table
DROP INDEX IF EXISTS idx_run_history_installation;
DROP INDEX IF EXISTS idx_run_history_repo;
DROP INDEX IF EXISTS idx_run_history_status;
DROP INDEX IF EXISTS idx_run_history_created_at;

-- Drop the new table
DROP TABLE IF EXISTS run_history;

-- Restore the original table name
ALTER TABLE IF EXISTS run_history_legacy RENAME TO run_history;

COMMIT;
