-- Billing + teams / repos / invites / team_members (tenant commercial domain)

BEGIN;

CREATE TABLE IF NOT EXISTS billing (
    id                      SERIAL PRIMARY KEY,
    account_id              INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    stripe_customer_id      VARCHAR(255),
    stripe_subscription_id  VARCHAR(255),
    plan                    VARCHAR(50) NOT NULL DEFAULT 'free',
    status                  VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    usage_count             INTEGER NOT NULL DEFAULT 0,
    user_id                 UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE billing ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_account ON billing(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_stripe_customer ON billing(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_plan ON billing(plan);
CREATE INDEX IF NOT EXISTS idx_billing_user_id ON billing(user_id);

CREATE TABLE IF NOT EXISTS teams (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    account_ids  INTEGER[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_account_ids ON teams USING GIN(account_ids);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

CREATE TABLE IF NOT EXISTS repos (
    id               SERIAL PRIMARY KEY,
    owner            VARCHAR(255) NOT NULL,
    name             VARCHAR(255) NOT NULL,
    installation_id  INTEGER NOT NULL,
    account_id       INTEGER NOT NULL,
    enabled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repos_account ON repos(account_id);
CREATE INDEX IF NOT EXISTS idx_repos_installation ON repos(installation_id);
CREATE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name);

CREATE TABLE IF NOT EXISTS invites (
    id                     SERIAL PRIMARY KEY,
    email                  VARCHAR(320) NOT NULL UNIQUE,
    invited_by             VARCHAR(128),
    role                   TEXT NOT NULL DEFAULT 'member',
    token                  VARCHAR(128),
    status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at            TIMESTAMPTZ,
    team_id                INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    monthly_limit_credits  INTEGER
);

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS monthly_limit_credits INTEGER;

CREATE INDEX IF NOT EXISTS idx_invites_team ON invites(team_id);

CREATE TABLE IF NOT EXISTS team_members (
    id                    SERIAL PRIMARY KEY,
    team_id               INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role                  TEXT NOT NULL DEFAULT 'member',
    monthly_limit_credits INTEGER,
    joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (team_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members(account_id);

INSERT INTO team_members (team_id, account_id, role, monthly_limit_credits, joined_at)
SELECT t.id, member_account_id, 'member', NULL, NOW()
FROM teams t
CROSS JOIN LATERAL unnest(t.account_ids) AS member_account_id
ON CONFLICT (team_id, account_id) DO NOTHING;

COMMIT;
