-- MCP API keys for agent access (per-user)
-- Migration: 020_mcp_api_keys
-- NOTE: user_id is TEXT (no FK) following 019_refresh_tokens pattern —
-- users.id changes from INTEGER to UUID in migration 018 which is not yet
-- applied on all environments; avoiding the FK keeps this migration
-- independent of that transition.

CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_user_id ON mcp_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash ON mcp_api_keys(key_hash);
