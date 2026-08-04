-- LLM-routing tier/variant columns on fix-run records (AIM-4622)
-- difficulty_tier 1-4 and variant low/medium/high/max follow the
-- OpenSymphony DifficultyRouter contract so run status and audit surfaces
-- can report which routing variant was used.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS difficulty_tier INTEGER;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS variant VARCHAR(20);

ALTER TABLE run_history ADD COLUMN IF NOT EXISTS difficulty_tier INTEGER;
ALTER TABLE run_history ADD COLUMN IF NOT EXISTS variant VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_runs_difficulty_tier ON runs(difficulty_tier);
CREATE INDEX IF NOT EXISTS idx_runs_variant ON runs(variant);
