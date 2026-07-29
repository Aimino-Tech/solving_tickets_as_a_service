-- AIM-3513: Workspace table — persistent storage replacing in-memory Map
-- Migration: 012_workspaces
--
-- Stores workspace lifecycle records with Slack/GitHub integration metadata.
-- Soft-delete via deleted_at for data retention compliance.
-- Tenant isolation via tenant_id on every row.

BEGIN;

CREATE TABLE IF NOT EXISTS workspaces (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    tenant_id           VARCHAR(255) NOT NULL,
    plan_id             VARCHAR(50) NOT NULL DEFAULT 'free',
    seats               INTEGER NOT NULL DEFAULT 1,
    status              VARCHAR(20) NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','setup','active','suspended','deleted')),
    slack_team_id       VARCHAR(255),
    slack_bot_token     TEXT,
    slack_channel       VARCHAR(255),
    github_installation_id BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at        TIMESTAMPTZ,
    suspended_at        TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_id
    ON workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_status
    ON workspaces(status);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_status
    ON workspaces(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_workspaces_created_at
    ON workspaces(created_at DESC);

COMMIT;
