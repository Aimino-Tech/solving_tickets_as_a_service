CREATE TABLE IF NOT EXISTS cookie_consent (
  user_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
