-- Add trial_start / trial_end to accounts to match the trial.ts schema
-- (accounts previously only had trial_ends_at from 005_multi_tenant / 016).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
