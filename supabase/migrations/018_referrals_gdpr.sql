-- Referrals + GDPR / consent (user-owned growth & compliance)

BEGIN;

CREATE TABLE IF NOT EXISTS referral_codes (
    account_id  INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id                    SERIAL PRIMARY KEY,
    referrer_account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    referred_email        VARCHAR(255) NOT NULL,
    amount_credits        INTEGER NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_account ON referral_rewards(referrer_account_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE TABLE IF NOT EXISTS consent_preferences (
    user_id     VARCHAR(128) PRIMARY KEY,
    analytics   BOOLEAN NOT NULL DEFAULT false,
    marketing   BOOLEAN NOT NULL DEFAULT false,
    functional  BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dpa_acceptance (
    id          SERIAL PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    version     VARCHAR(50) NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address  VARCHAR(45)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dpa_acceptance_account_version
  ON dpa_acceptance(account_id, version);

CREATE TABLE IF NOT EXISTS data_deletion_requests (
    id                     SERIAL PRIMARY KEY,
    account_id             INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    requested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_deletion_at  TIMESTAMPTZ NOT NULL,
    status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_account ON data_deletion_requests(account_id);
CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_scheduled
  ON data_deletion_requests(scheduled_deletion_at) WHERE status = 'pending';

COMMIT;
