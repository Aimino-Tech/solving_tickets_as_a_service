-- AIM-4644: Billing balance features — coupons, auto-reload, monthly usage limit
-- Migration: 022_account_billing_settings

BEGIN;

-- Coupon ledger (plain promo codes crediting the account balance)
CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    amount_credits INTEGER NOT NULL CHECK (amount_credits > 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    max_redemptions INTEGER,
    times_redeemed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- Billing balance settings on the account
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS auto_reload_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_reload_threshold_cents INTEGER,
    ADD COLUMN IF NOT EXISTS auto_reload_topup_cents INTEGER,
    ADD COLUMN IF NOT EXISTS monthly_limit_cents INTEGER;

COMMIT;
