-- AIM-3525: Add credits_used column to runs table for per-ticket cost tracking

BEGIN;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS credits_used INTEGER;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cost_cents INTEGER;

COMMIT;
