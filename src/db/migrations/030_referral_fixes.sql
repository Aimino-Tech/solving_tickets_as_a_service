-- AIM-4643: Referral rewards pivot from credits to fixes.
-- Each referral now grants 10 fixes (accounts.referral_fixes_remaining) to
-- both referrer and referee instead of 500 credits. The quota gate consumes
-- this allowance past the plan limit (see src/pricing/middleware.ts).
-- Migration: 030_referral_fixes
--
-- Self-hosted safety: idempotent (IF NOT EXISTS).

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referral_fixes_remaining INTEGER NOT NULL DEFAULT 0;

ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS amount_fixes INTEGER NOT NULL DEFAULT 0;

COMMIT;
