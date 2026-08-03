BEGIN;
CREATE TABLE IF NOT EXISTS linear_oauth_tokens (
  user_id VARCHAR(128) PRIMARY KEY,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  linear_user_id VARCHAR(128),
  linear_login TEXT,
  token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
