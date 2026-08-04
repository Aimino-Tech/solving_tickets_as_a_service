-- AIM-4645: Usage limit preferences on accounts.
-- Portal toggle:
--   use_balance_after_limits — allow fix runs past the plan limit by consuming credits
BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS use_balance_after_limits BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
