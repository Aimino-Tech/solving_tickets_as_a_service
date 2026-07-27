-- AIM-3522: GitHub App OAuth tokens and installations
-- Migration: 015_github_oauth
--
-- Stores encrypted OAuth access tokens per user for GitHub API access
-- and tracks GitHub App installations linked to STAS user accounts.
--
-- The github_oauth_tokens table holds per-user GitHub OAuth tokens (encrypted).
-- The github_installations table maps GitHub App installation IDs to user accounts
-- so the app can act on behalf of the user's installed repos.

BEGIN;

CREATE TABLE IF NOT EXISTS github_oauth_tokens (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    github_login        VARCHAR(255) NOT NULL,
    github_user_id      BIGINT NOT NULL,
    token_expires_at    TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    scope               VARCHAR(500),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS github_installations (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id     BIGINT NOT NULL,
    account_login       VARCHAR(255) NOT NULL,
    account_type        VARCHAR(50) NOT NULL DEFAULT 'User'
                        CHECK (account_type IN ('User', 'Organization')),
    repo_scope          VARCHAR(20) NOT NULL DEFAULT 'selected'
                        CHECK (repo_scope IN ('all', 'selected')),
    permissions         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(installation_id)
);

CREATE TABLE IF NOT EXISTS github_webhook_configs (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id     BIGINT NOT NULL,
    repo_owner          VARCHAR(255) NOT NULL,
    repo_name           VARCHAR(255) NOT NULL,
    webhook_id          BIGINT NOT NULL,
    webhook_url         VARCHAR(500) NOT NULL,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    events              TEXT[] NOT NULL DEFAULT '{issues,pull_request}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(installation_id, repo_owner, repo_name)
);

CREATE INDEX IF NOT EXISTS idx_github_oauth_user_id
    ON github_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_github_installations_user_id
    ON github_installations(user_id);
CREATE INDEX IF NOT EXISTS idx_github_installations_installation_id
    ON github_installations(installation_id);
CREATE INDEX IF NOT EXISTS idx_github_webhook_configs_user_id
    ON github_webhook_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_github_webhook_configs_installation_id
    ON github_webhook_configs(installation_id);
CREATE INDEX IF NOT EXISTS idx_github_webhook_configs_repo
    ON github_webhook_configs(repo_owner, repo_name);

COMMIT;
