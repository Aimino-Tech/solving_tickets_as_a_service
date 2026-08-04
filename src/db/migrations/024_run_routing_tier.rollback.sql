-- AIM-4622 rollback: remove difficulty-tier routing columns from run_history.

BEGIN;

DROP INDEX IF EXISTS idx_run_history_routing_tier;
ALTER TABLE IF EXISTS run_history
  DROP COLUMN IF EXISTS routing_variant,
  DROP COLUMN IF EXISTS routing_tier;

COMMIT;
