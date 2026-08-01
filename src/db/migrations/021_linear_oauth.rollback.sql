-- AIM-4496: rollback for 021_linear_oauth
BEGIN;
DROP TABLE IF EXISTS linear_oauth_tokens;
COMMIT;
