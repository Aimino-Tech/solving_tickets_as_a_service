-- AIM-4645: Usage limit + provider routing preferences on accounts.
-- Portal toggles:
--   use_balance_after_limits — allow fix runs past the plan limit by consuming credits
--   enable_china_models      — allow China-hosted models in provider routing
BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS use_balance_after_limits BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enable_china_models BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
