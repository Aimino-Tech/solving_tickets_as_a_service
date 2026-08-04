-- Accounts + credit ledger (user commercial domain)
-- Idempotent CREATE / ADD COLUMN for fresh Supabase and existing app DBs.

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
    id                       SERIAL PRIMARY KEY,
    github_installation_id   INTEGER NOT NULL UNIQUE,
    email                    VARCHAR(255),
    name                     VARCHAR(255),
    tier                     VARCHAR(50) NOT NULL DEFAULT 'free',
    github_user_id           INTEGER,
    github_app_installation_id INTEGER,
    plan                     VARCHAR(50) NOT NULL DEFAULT 'free',
    trial_ends_at            TIMESTAMPTZ,
    user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
    auto_reload_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    auto_reload_threshold_cents INTEGER,
    auto_reload_topup_cents  INTEGER,
    monthly_limit_cents      INTEGER,
    use_balance_after_limits BOOLEAN NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS github_user_id INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS github_app_installation_id INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auto_reload_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auto_reload_threshold_cents INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auto_reload_topup_cents INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS monthly_limit_cents INTEGER;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS use_balance_after_limits BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE accounts SET plan = tier WHERE plan IS NULL OR plan = 'free';

CREATE TABLE IF NOT EXISTS credit_balances (
    id                SERIAL PRIMARY KEY,
    account_id        INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    balance           INTEGER NOT NULL DEFAULT 0,
    lifetime_credits  INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id                       SERIAL PRIMARY KEY,
    account_id               INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount                   INTEGER NOT NULL,
    type                     VARCHAR(50) NOT NULL,
    description              TEXT,
    stripe_payment_intent_id VARCHAR(255),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_records (
    id            SERIAL PRIMARY KEY,
    account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    issue_id      INTEGER,
    repo          VARCHAR(255),
    action        VARCHAR(100) NOT NULL,
    credits_used  INTEGER NOT NULL DEFAULT 0,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
    id               SERIAL PRIMARY KEY,
    code             VARCHAR(100) NOT NULL UNIQUE,
    amount_credits   INTEGER NOT NULL CHECK (amount_credits > 0),
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    max_redemptions  INTEGER,
    times_redeemed   INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_plan ON accounts(plan);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(github_user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_account ON credit_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_account ON usage_records(account_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

COMMIT;
