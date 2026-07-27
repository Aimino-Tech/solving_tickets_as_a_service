CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating TEXT NOT NULL CHECK (rating IN ('worked', 'not_working', 'partial')),
  comment TEXT DEFAULT '',
  action TEXT NOT NULL DEFAULT 'none' CHECK (action IN ('none', 'retry', 'escalate', 'cancel', 'rollback')),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_run_id ON feedback(run_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
