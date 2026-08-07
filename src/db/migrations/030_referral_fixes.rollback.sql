-- Rollback for 030_referral_fixes.sql
-- Migration: 030_referral_fixes

BEGIN;

ALTER TABLE accounts DROP COLUMN IF EXISTS referral_fixes_remaining;

ALTER TABLE referral_rewards DROP COLUMN IF EXISTS amount_fixes;

COMMIT;
