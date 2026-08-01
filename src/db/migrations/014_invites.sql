BEGIN;
CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  invited_by VARCHAR(128),
  role TEXT NOT NULL DEFAULT 'member',
  token VARCHAR(128),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);
COMMIT;
