-- Rollback multi-tenant schema changes
-- Migration rollback: 005_multi_tenant

-- Drop new tables
DROP TABLE IF EXISTS billing CASCADE;
DROP TABLE IF EXISTS runs CASCADE;
DROP TABLE IF EXISTS repos CASCADE;
DROP TABLE IF EXISTS teams CASCADE;

-- Drop new indexes
DROP INDEX IF EXISTS idx_accounts_plan;
DROP INDEX IF EXISTS idx_accounts_user;
DROP INDEX IF EXISTS idx_audit_logs_actor;
DROP INDEX IF EXISTS idx_audit_logs_target;
DROP INDEX IF EXISTS idx_runs_account;
DROP INDEX IF EXISTS idx_runs_repo;
DROP INDEX IF EXISTS idx_runs_status;
DROP INDEX IF EXISTS idx_runs_created;
DROP INDEX IF EXISTS idx_repos_account;
DROP INDEX IF EXISTS idx_repos_installation;
DROP INDEX IF EXISTS idx_repos_owner_name;
DROP INDEX IF EXISTS idx_billing_account;
DROP INDEX IF EXISTS idx_billing_stripe_customer;
DROP INDEX IF EXISTS idx_billing_plan;
DROP INDEX IF EXISTS idx_teams_account_ids;

-- Remove columns added to existing tables
ALTER TABLE accounts
  DROP COLUMN IF EXISTS github_user_id,
  DROP COLUMN IF EXISTS github_app_installation_id,
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS trial_ends_at;

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS actor,
  DROP COLUMN IF EXISTS target;
