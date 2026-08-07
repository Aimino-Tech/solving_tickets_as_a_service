-- AIM-4643 + AIM-4645 rollback: restore opt-in overage consumption.
-- Migration: 028_referral_credits_auto.rollback

BEGIN;

ALTER TABLE accounts ALTER COLUMN use_balance_after_limits SET DEFAULT FALSE;
UPDATE accounts SET use_balance_after_limits = FALSE WHERE use_balance_after_limits = TRUE;

COMMIT;
