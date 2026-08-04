BEGIN;

ALTER TABLE accounts DROP COLUMN IF EXISTS use_balance_after_limits;

COMMIT;
