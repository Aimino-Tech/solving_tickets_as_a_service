-- Per-user Bitbucket Cloud App Password connections
-- Migration: 024_bitbucket_connections
--
-- Stores encrypted App Passwords so each logged-in dashboard user can connect
-- their own Bitbucket workspace. UNIQUE(workspace) lets webhook handlers
-- resolve credentials by workspace slug (one SYNTARO user per BB workspace).
--
-- NOTE: user_id is TEXT (no FK) following 023_slack_oauth_tokens /
-- 020_mcp_api_keys — Supabase users are UUIDs while legacy rows may be numeric.

BEGIN;

CREATE TABLE IF NOT EXISTS bitbucket_connections (
  user_id                VARCHAR(128) PRIMARY KEY,
  username               VARCHAR(255) NOT NULL,
  app_password_encrypted TEXT NOT NULL,
  workspace              VARCHAR(255) NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bitbucket_connections_workspace
  ON bitbucket_connections(workspace);

CREATE INDEX IF NOT EXISTS idx_bitbucket_connections_user_id
  ON bitbucket_connections(user_id);

COMMIT;
