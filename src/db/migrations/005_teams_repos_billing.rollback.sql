-- Rollback AIM-1214: Drop teams, repos, and billing tables.

BEGIN;

-- Drop billing indexes and table
DROP INDEX IF EXISTS idx_billing_account;
DROP INDEX IF EXISTS idx_billing_stripe_customer;
DROP INDEX IF EXISTS idx_billing_stripe_subscription;
DROP INDEX IF EXISTS idx_billing_status;
DROP TABLE IF EXISTS billing;

-- Drop repos indexes and table
DROP INDEX IF EXISTS idx_repos_account;
DROP INDEX IF EXISTS idx_repos_installation;
DROP INDEX IF EXISTS idx_repos_owner_name;
DROP TABLE IF EXISTS repos;

-- Drop teams indexes and table
DROP INDEX IF EXISTS idx_teams_name;
DROP TABLE IF EXISTS teams;

COMMIT;
