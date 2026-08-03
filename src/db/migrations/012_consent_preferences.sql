BEGIN;
CREATE TABLE IF NOT EXISTS consent_preferences (
    user_id VARCHAR(128) PRIMARY KEY,
    analytics BOOLEAN NOT NULL DEFAULT false,
    marketing BOOLEAN NOT NULL DEFAULT false,
    functional BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
