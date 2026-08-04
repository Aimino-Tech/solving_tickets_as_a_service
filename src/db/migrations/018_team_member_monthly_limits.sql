-- AIM-4642: Team member monthly limits
--
-- Adds per-member monthly credit limits on top of the team_members
-- representation and scopes email invites to a team.
--
-- 1. team_members   — canonical member row (team_id, account_id, role,
--                     monthly_limit_credits, joined_at). Backfills existing
--                     membership from the legacy teams.account_ids array and
--                     promotes owners to admin where owner_account_id exists.
-- 2. invites        — adds team_id (team-scoped pending invites) and
--                     monthly_limit_credits so invited members can carry a
--                     pre-set limit.

BEGIN;

-- ============================================================================
-- 1. team_members table
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_members (
    id                   SERIAL PRIMARY KEY,
    team_id              INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    account_id           INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role                 TEXT NOT NULL DEFAULT 'member',
    monthly_limit_credits INTEGER,
    joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (team_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members(account_id);

-- Backfill from legacy teams.account_ids array (idempotent)
INSERT INTO team_members (team_id, account_id, role, monthly_limit_credits, joined_at)
SELECT t.id, member_account_id, 'member', NULL, NOW()
FROM teams t
CROSS JOIN LATERAL unnest(t.account_ids) AS member_account_id
ON CONFLICT (team_id, account_id) DO NOTHING;

-- Promote owners to admin where owner_account_id exists (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'owner_account_id'
  ) THEN
    UPDATE team_members tm
    SET role = 'admin'
    FROM teams t
    WHERE tm.team_id = t.id AND t.owner_account_id = tm.account_id;
  END IF;
END $$;

-- ============================================================================
-- 2. invites — team scoping + monthly limit
-- ============================================================================
ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS monthly_limit_credits INTEGER;

CREATE INDEX IF NOT EXISTS idx_invites_team ON invites(team_id);

COMMIT;
