-- AIM-4643 rollback: Referral program — $5 credit for referrer + referee
BEGIN;

DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referral_codes;
ALTER TABLE users DROP COLUMN IF EXISTS referral_code;

COMMIT;
