-- AIM: Internal tickets & warnings store (DB-first retrieval, decoupled from platforms)
CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  kind TEXT NOT NULL DEFAULT 'ticket',
  severity TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  fix_dispatch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_account_created ON tickets(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_repo ON tickets(repo_owner, repo_name, issue_number);
