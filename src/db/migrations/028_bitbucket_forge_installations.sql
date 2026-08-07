-- Forge (Bitbucket App) installations
-- Migration: 028_bitbucket_forge_installations
--
-- Registers Bitbucket workspaces that installed the SYNTARO Forge app, and
-- caches the per-invocation x-forge-oauth-system token so the worker can act
-- as the app's bot user (git clone/push, PRs, comments) without waiting for
-- the next event. The token is rotated on every event / lifecycle /
-- scheduled-trigger invocation.
--
-- installation_id: Forge installation id from the FIT token (app.installationId)
-- workspace_uuid/slug: populated by the first product event (events carry
--   workspace.uuid; slug is resolved once via GET /2.0/workspaces/{uuid})
-- system_token_encrypted: latest x-forge-oauth-system token (AES-256-GCM)

BEGIN;

CREATE TABLE IF NOT EXISTS bitbucket_forge_installations (
  installation_id        TEXT PRIMARY KEY,
  app_id                 TEXT NOT NULL,
  workspace_uuid         TEXT,
  workspace_slug         TEXT,
  api_base_url           TEXT,
  system_token_encrypted TEXT,
  token_expires_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitbucket_forge_installations_workspace_slug
  ON bitbucket_forge_installations(workspace_slug);

CREATE INDEX IF NOT EXISTS idx_bitbucket_forge_installations_workspace_uuid
  ON bitbucket_forge_installations(workspace_uuid);

COMMIT;
