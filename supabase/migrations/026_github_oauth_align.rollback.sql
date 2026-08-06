-- Rollback 026_github_oauth_align
DROP INDEX IF EXISTS idx_github_webhook_repo_owner_repo_name;
DROP INDEX IF EXISTS idx_github_webhook_installation_active;

ALTER TABLE github_webhook_configs
  DROP COLUMN IF EXISTS events,
  DROP COLUMN IF EXISTS repo_name,
  DROP COLUMN IF EXISTS repo_owner;

ALTER TABLE github_installations
  DROP COLUMN IF EXISTS repos_json,
  DROP COLUMN IF EXISTS avatar_url;
