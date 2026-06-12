-- AIM-1249: Add percentage_rollout column to feature_flags for gradual rollout
-- Also adds auto_disabled column used by auto-disable on error spike

BEGIN;

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS percentage_rollout INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS auto_disabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
