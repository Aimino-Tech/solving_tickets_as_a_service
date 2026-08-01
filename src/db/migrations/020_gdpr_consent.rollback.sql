-- AIM-4496: GDPR compliance core — rollback for 020_gdpr_consent
BEGIN;
DROP TABLE IF EXISTS consent_preferences;
COMMIT;
