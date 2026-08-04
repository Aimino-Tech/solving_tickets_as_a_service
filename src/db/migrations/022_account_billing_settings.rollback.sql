-- Rollback for 022_account_billing_settings
BEGIN;

DROP TABLE IF EXISTS coupons;

ALTER TABLE accounts
    DROP COLUMN IF EXISTS auto_reload_enabled,
    DROP COLUMN IF EXISTS auto_reload_threshold_cents,
    DROP COLUMN IF EXISTS auto_reload_topup_cents,
    DROP COLUMN IF EXISTS monthly_limit_cents;

COMMIT;
