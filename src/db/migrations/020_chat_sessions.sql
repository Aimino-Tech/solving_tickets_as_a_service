-- Chat session store: durable thread_ts -> session_id -> user_id mapping.
-- One pod connection = one conversation = one opencode session.
-- State lives outside the pod; the pod is disposable.
-- Migration: 020_chat_sessions

CREATE TABLE IF NOT EXISTS chat_sessions (
  thread_ts TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_memory JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
