-- AIM-4496: GDPR compliance core — consent preferences table
-- Migration: 020_gdpr_consent
BEGIN;

CREATE TABLE IF NOT EXISTS consent_preferences (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_key    VARCHAR(50) NOT NULL,
    granted        BOOLEAN NOT NULL DEFAULT false,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_preferences_user_key ON consent_preferences(user_id, consent_key);
CREATE INDEX IF NOT EXISTS idx_consent_preferences_user ON consent_preferences(user_id);

COMMIT;
