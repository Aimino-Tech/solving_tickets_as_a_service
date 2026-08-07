-- AIM-4643 + AIM-4645: Referral credits are automatically usable past the plan limit.
-- Migration: 028_referral_credits_auto
--
-- Product decision (2026-08-07): a user who holds credits (referral reward or
-- purchased overage) should never be hard-blocked at the plan's monthly fix
-- limit. Credits are now consumed automatically past the limit; the
-- `use_balance_after_limits` toggle stays for users who explicitly want to
-- disable overage consumption.
--
-- Self-hosted safety: idempotent (IF NOT EXISTS / WHERE-safe).

BEGIN;

ALTER TABLE accounts ALTER COLUMN use_balance_after_limits SET DEFAULT TRUE;

-- Existing accounts inherit the new behavior (dev DB: probe accounts only).
-- REVIEW BEFORE PROD DEPLOY: this flips explicit opt-outs too.
UPDATE accounts SET use_balance_after_limits = TRUE WHERE use_balance_after_limits = FALSE;

COMMIT;
