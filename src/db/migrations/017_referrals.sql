-- AIM-4643: Referral program — $5 credit for referrer + referee
-- Migration: 017_referrals
--
-- Referral codes are one-per-account (keyed by accounts.id, same id used by
-- the credits system). referral_rewards rows track pending/claimed rewards;
-- referrer_account_id is the account that RECEIVES the reward (the referrer's
-- own row, or the referee's row once they claim their $5).
--
-- Self-hosted safety: ALL operations use IF NOT EXISTS / IF EXISTS patterns.

BEGIN;

-- One referral code per account
CREATE TABLE IF NOT EXISTS referral_codes (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending/claimed referral rewards
CREATE TABLE IF NOT EXISTS referral_rewards (
    id SERIAL PRIMARY KEY,
    referrer_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    referred_email VARCHAR(255) NOT NULL,
    amount_credits INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_account ON referral_rewards(referrer_account_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);

-- Referral code used at signup (stored on the new user, nullable)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;

COMMIT;
