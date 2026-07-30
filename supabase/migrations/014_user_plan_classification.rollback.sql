BEGIN;

DROP INDEX IF EXISTS idx_users_plan;
DROP INDEX IF EXISTS idx_users_stripe_customer;
ALTER TABLE users DROP COLUMN IF EXISTS plan;
ALTER TABLE users DROP COLUMN IF EXISTS trial_start;
ALTER TABLE users DROP COLUMN IF EXISTS trial_end;
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE users DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE users DROP COLUMN IF EXISTS subscription_id;

COMMIT;
