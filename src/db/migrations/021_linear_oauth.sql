-- AIM-4496: Linear OAuth tokens table
-- Migration: 021_linear_oauth
BEGIN;

CREATE TABLE IF NOT EXISTS linear_oauth_tokens (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_encrypted  TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    linear_user_id          VARCHAR(255),
    linear_user_name        VARCHAR(255),
    linear_user_email       VARCHAR(255),
    scope                   TEXT,
    token_expires_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_linear_oauth_user_id ON linear_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_linear_oauth_linear_user_id ON linear_oauth_tokens(linear_user_id);

COMMIT;
