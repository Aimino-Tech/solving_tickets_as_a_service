-- AIM-4496: rollback for 022_team_invites
BEGIN;
DROP TABLE IF EXISTS team_invites;
COMMIT;
