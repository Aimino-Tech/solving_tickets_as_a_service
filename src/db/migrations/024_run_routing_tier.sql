-- AIM-4622: Add difficulty-tier routing columns to run_history.
-- Records which routed variant (model + tier) produced a fix, for
-- transparency in the status/MCP flow and audit.

BEGIN;

ALTER TABLE IF EXISTS run_history
  ADD COLUMN IF NOT EXISTS routing_tier INTEGER,
  ADD COLUMN IF NOT EXISTS routing_variant TEXT;

CREATE INDEX IF NOT EXISTS idx_run_history_routing_tier ON run_history(routing_tier);

COMMIT;
