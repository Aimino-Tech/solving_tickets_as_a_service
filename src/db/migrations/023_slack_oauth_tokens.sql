-- AIM-4491: Per-user Slack tokens
-- Migration: 023_slack_oauth_tokens
--
-- Stores per-user Slack bot/app tokens (encrypted) so each user's
-- connection state is isolated. Mirrors linear_oauth_tokens/github_oauth_tokens.
--
-- NOTE: user_id is TEXT (no FK) following 020_mcp_api_keys pattern —
-- Supabase users are UUIDs while legacy rows may be numeric strings.

BEGIN;

CREATE TABLE IF NOT EXISTS slack_oauth_tokens (
  user_id                VARCHAR(128) PRIMARY KEY,
  bot_token_encrypted    TEXT NOT NULL,
  app_token_encrypted    TEXT,
  slack_team_id          VARCHAR(255),
  slack_team_name        TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_oauth_tokens_user_id
  ON slack_oauth_tokens(user_id);

COMMIT;
