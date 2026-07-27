-- Rollback 016_credit_usage: Remove credits_used column from runs table
BEGIN;
ALTER TABLE runs DROP COLUMN IF EXISTS credits_used;
COMMIT;
