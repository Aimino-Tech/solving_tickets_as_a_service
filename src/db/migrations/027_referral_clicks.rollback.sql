-- Rollback for 027_referral_clicks.sql
-- Migration: 027_referral_clicks

BEGIN;

ALTER TABLE referral_codes DROP COLUMN IF EXISTS clicks;

COMMIT;
