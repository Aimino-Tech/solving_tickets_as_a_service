BEGIN;

ALTER TABLE accounts DROP COLUMN IF EXISTS enable_china_models;
ALTER TABLE accounts DROP COLUMN IF EXISTS use_balance_after_limits;

COMMIT;
