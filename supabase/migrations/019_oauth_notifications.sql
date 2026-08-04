-- Per-user OAuth tokens + notification prefs (UUID user_id)
-- Final shape matches post-AIM-3610 (UUID FKs).

BEGIN;

CREATE TABLE IF NOT EXISTS github_oauth_tokens (
    id                       SERIAL PRIMARY KEY,
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_encrypted   TEXT NOT NULL,
    refresh_token_encrypted  TEXT,
    github_login             VARCHAR(255) NOT NULL,
    github_user_id           BIGINT NOT NULL,
    avatar_url               TEXT,
    scope                    TEXT,
    token_expires_at         TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_oauth_user_id ON github_oauth_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_oauth_github_user_id ON github_oauth_tokens(github_user_id);

CREATE TABLE IF NOT EXISTS github_installations (
    id               SERIAL PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id  BIGINT NOT NULL,
    account_login    VARCHAR(255) NOT NULL,
    account_type     VARCHAR(50) NOT NULL DEFAULT 'User',
    repo_scope       VARCHAR(20) NOT NULL DEFAULT 'selected',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_installations_inst_id ON github_installations(installation_id);
CREATE INDEX IF NOT EXISTS idx_github_installations_user_id ON github_installations(user_id);

CREATE TABLE IF NOT EXISTS github_webhook_configs (
    id               SERIAL PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    installation_id  BIGINT NOT NULL,
    owner            VARCHAR(255) NOT NULL,
    repo             VARCHAR(255) NOT NULL,
    webhook_id       BIGINT NOT NULL,
    webhook_url      TEXT NOT NULL,
    active           BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_webhook_owner_repo ON github_webhook_configs(owner, repo);
CREATE INDEX IF NOT EXISTS idx_github_webhook_user_id ON github_webhook_configs(user_id);

CREATE TABLE IF NOT EXISTS linear_oauth_tokens (
    user_id                  VARCHAR(128) PRIMARY KEY,
    access_token_encrypted   TEXT NOT NULL,
    refresh_token_encrypted  TEXT,
    linear_user_id           VARCHAR(128),
    linear_login             TEXT,
    token_expires_at         TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    scope                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_oauth_tokens (
    user_id               VARCHAR(128) PRIMARY KEY,
    bot_token_encrypted   TEXT NOT NULL,
    app_token_encrypted   TEXT,
    slack_team_id         VARCHAR(255),
    slack_team_name       TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_oauth_tokens_user_id ON slack_oauth_tokens(user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         VARCHAR(50) NOT NULL
                    CHECK (channel IN ('email','slack','discord','webhook','in_app')),
    event_type      VARCHAR(50) NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    channel_target  VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, channel, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id ON notification_preferences(user_id);

CREATE TABLE IF NOT EXISTS notification_history (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type  VARCHAR(100) NOT NULL,
    channel     VARCHAR(50) NOT NULL DEFAULT 'in_app',
    title       VARCHAR(255),
    body        TEXT,
    metadata    JSONB,
    read_at     TIMESTAMPTZ,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS read BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notification_history_user ON notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_event ON notification_history(event_type);
CREATE INDEX IF NOT EXISTS idx_notification_history_created ON notification_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_history_user_read ON notification_history(user_id, read);

COMMIT;
