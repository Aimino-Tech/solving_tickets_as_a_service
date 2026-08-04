-- Rollback 018_referrals_gdpr
DROP TABLE IF EXISTS data_deletion_requests CASCADE;
DROP TABLE IF EXISTS dpa_acceptance CASCADE;
DROP TABLE IF EXISTS consent_preferences CASCADE;
DROP TABLE IF EXISTS referral_rewards CASCADE;
DROP TABLE IF EXISTS referral_codes CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS referral_code;
