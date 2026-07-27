BEGIN;

CREATE TABLE IF NOT EXISTS run_feedback (
    id              SERIAL PRIMARY KEY,
    run_id          INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verdict         VARCHAR(50) NOT NULL CHECK (verdict IN ('good', 'bad_fix', 'not_working', 'escalate')),
    comment         TEXT,
    action_taken    VARCHAR(50) DEFAULT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_feedback_run_id ON run_feedback(run_id);
CREATE INDEX IF NOT EXISTS idx_run_feedback_verdict ON run_feedback(verdict);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS feedback_verdict VARCHAR(50) DEFAULT NULL;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ DEFAULT NULL;

COMMIT;
