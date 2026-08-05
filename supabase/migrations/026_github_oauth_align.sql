-- Align GitHub OAuth tables with the current repository layer.
-- Migration: 026_github_oauth_align
--
-- The GitHub tables were first created in 019_oauth_notifications (user-domain)
-- and 015_github_oauth (ops, historical). Since then the repositories moved to
-- different columns:
--
--   github_installations   : GitHubInstallationRepository reads/writes
--                            avatar_url + repos_json (jsonb) — both missing.
--   github_webhook_configs : GitHubWebhookRepository queries repo_owner /
--                            repo_name (legacy columns are owner/repo) and
--                            events — missing.
--
-- This migration adds the missing columns idempotently and backfills the new
-- names from the legacy ones so existing rows keep working. Applied by
-- src/db/migrate.ts before ops migrations, tracked as supabase/<file>.sql.

BEGIN;

-- github_installations — avatar + repository manifest for connected accounts
ALTER TABLE github_installations
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS repos_json JSONB NOT NULL DEFAULT '[]';

-- github_webhook_configs — rename-aligned columns + events payload
ALTER TABLE github_webhook_configs
  ADD COLUMN IF NOT EXISTS repo_owner VARCHAR(255),
  ADD COLUMN IF NOT EXISTS repo_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS events     JSONB NOT NULL DEFAULT '[]';

-- Backfill new columns from legacy owner/repo (idempotent: no-op on re-run)
UPDATE github_webhook_configs
   SET repo_owner = owner,
       repo_name  = repo
 WHERE repo_owner IS NULL AND owner IS NOT NULL;

-- Indexes for the query paths GitHubWebhookRepository actually uses
CREATE INDEX IF NOT EXISTS idx_github_webhook_installation_active
  ON github_webhook_configs(installation_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_webhook_repo_owner_repo_name
  ON github_webhook_configs(repo_owner, repo_name)
  WHERE repo_owner IS NOT NULL;

COMMIT;
