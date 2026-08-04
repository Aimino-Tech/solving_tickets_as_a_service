-- Rollback 016_accounts_credits
DROP TABLE IF EXISTS coupons CASCADE;
DROP TABLE IF EXISTS usage_records CASCADE;
DROP TABLE IF EXISTS credit_transactions CASCADE;
DROP TABLE IF EXISTS credit_balances CASCADE;
-- Keep accounts if billing/teams still reference it; full drop only via cascade from later rollbacks
ALTER TABLE accounts DROP COLUMN IF EXISTS use_balance_after_limits;
ALTER TABLE accounts DROP COLUMN IF EXISTS monthly_limit_cents;
ALTER TABLE accounts DROP COLUMN IF EXISTS auto_reload_topup_cents;
ALTER TABLE accounts DROP COLUMN IF EXISTS auto_reload_threshold_cents;
ALTER TABLE accounts DROP COLUMN IF EXISTS auto_reload_enabled;
