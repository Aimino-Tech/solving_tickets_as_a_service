-- AIM-4655: Referral click tracking — per-code click counter for the public
-- POST /api/v1/referral/click endpoint.
-- Migration: 027_referral_clicks
--
-- Self-hosted safety: idempotent (IF NOT EXISTS), matching 017_referrals.sql.

BEGIN;

ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS clicks INTEGER NOT NULL DEFAULT 0;

COMMIT;
