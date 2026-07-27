-- AIM-3522: GitHub OAuth tokens & installation management
-- Migration: 015_github_oauth
BEGIN;

CREATE TABLE IF NOT EXISTS github_oauth_tokens (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_encrypted  TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    github_login            VARCHAR(255) NOT NULL,
    github_user_id          BIGINT NOT NULL,
    avatar_url              TEXT,
    scope                   TEXT,
    token_expires_at        TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_oauth_user_id ON github_oauth_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_oauth_github_user_id ON github_oauth_tokens(github_user_id);

CREATE TABLE IF NOT EXISTS github_installations (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id   BIGINT NOT NULL,
    account_login     VARCHAR(255) NOT NULL,
    account_type      VARCHAR(50) NOT NULL DEFAULT 'User',
    repo_scope        VARCHAR(20) NOT NULL DEFAULT 'selected',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_installations_inst_id ON github_installations(installation_id);
CREATE INDEX IF NOT EXISTS idx_github_installations_user_id ON github_installations(user_id);

CREATE TABLE IF NOT EXISTS github_webhook_configs (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id   BIGINT NOT NULL,
    owner             VARCHAR(255) NOT NULL,
    repo              VARCHAR(255) NOT NULL,
    webhook_id        BIGINT NOT NULL,
    webhook_url       TEXT NOT NULL,
    active            BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_webhook_owner_repo ON github_webhook_configs(owner, repo);
CREATE INDEX IF NOT EXISTS idx_github_webhook_user_id ON github_webhook_configs(user_id);

COMMIT;
