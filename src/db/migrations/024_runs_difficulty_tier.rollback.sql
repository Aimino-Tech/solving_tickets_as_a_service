DROP INDEX IF EXISTS idx_runs_variant;
DROP INDEX IF EXISTS idx_runs_difficulty_tier;

ALTER TABLE run_history DROP COLUMN IF EXISTS variant;
ALTER TABLE run_history DROP COLUMN IF EXISTS difficulty_tier;

ALTER TABLE runs DROP COLUMN IF EXISTS variant;
ALTER TABLE runs DROP COLUMN IF EXISTS difficulty_tier;
