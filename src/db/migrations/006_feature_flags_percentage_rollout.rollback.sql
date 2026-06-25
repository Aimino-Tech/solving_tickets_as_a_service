BEGIN;

ALTER TABLE feature_flags DROP COLUMN IF EXISTS auto_disabled;
ALTER TABLE feature_flags DROP COLUMN IF EXISTS percentage_rollout;

COMMIT;
