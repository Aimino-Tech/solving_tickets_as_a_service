-- AIM-4496: invite-by-email — pending team invites table
-- Migration: 022_team_invites
BEGIN;

CREATE TABLE IF NOT EXISTS team_invites (
    id              SERIAL PRIMARY KEY,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'member',
    token           VARCHAR(64) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
    invited_by      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_invites_team_email ON team_invites(team_id, email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);
CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token);

COMMIT;
