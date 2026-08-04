-- Extend bitbucket_connections for OAuth 2.0 (Bearer access tokens).
-- Migration: 025_bitbucket_oauth_fields
--
-- auth_method:
--   api_token — Basic auth with Atlassian email:API token (existing path)
--   oauth     — Bearer access token from Bitbucket OAuth consumer

BEGIN;

ALTER TABLE bitbucket_connections
  ADD COLUMN IF NOT EXISTS auth_method VARCHAR(32) NOT NULL DEFAULT 'api_token',
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bitbucket_uuid VARCHAR(128),
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

COMMIT;
