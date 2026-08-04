-- AIM-4642 rollback: team member monthly limits
BEGIN;
ALTER TABLE invites
  DROP COLUMN IF EXISTS team_id,
  DROP COLUMN IF EXISTS monthly_limit_credits;
DROP INDEX IF EXISTS idx_invites_team;
DROP TABLE IF EXISTS team_members;
COMMIT;
