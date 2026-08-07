-- Rollback for 029_referral_referee_account.sql
-- Migration: 029_referral_referee_account

BEGIN;

ALTER TABLE referral_rewards DROP COLUMN IF EXISTS referee_account_id;

COMMIT;
