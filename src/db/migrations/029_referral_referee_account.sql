-- AIM-4656: Referral anti-fraud — link each reward row to the referee's
-- account so claim qualification (referee completed a fix run) can be gated.
-- Migration: 029_referral_referee_account
--
-- Self-hosted safety: idempotent (IF NOT EXISTS / WHERE-safe backfill).

BEGIN;

ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS referee_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;

-- Backfill existing rows whose referee already has an accounts row (matched
-- by exact email). Rows without a matching account stay NULL and are treated
-- as not-yet-qualified by the claim gate.
UPDATE referral_rewards rr
   SET referee_account_id = (SELECT id FROM accounts WHERE email = rr.referred_email)
 WHERE referee_account_id IS NULL
   AND EXISTS (SELECT 1 FROM accounts WHERE email = rr.referred_email);

COMMIT;
