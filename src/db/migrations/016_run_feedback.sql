BEGIN;

CREATE TABLE IF NOT EXISTS run_feedback (
    id              SERIAL PRIMARY KEY,
    run_id          VARCHAR(255) NOT NULL,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verdict         VARCHAR(50) NOT NULL
                    CHECK (verdict IN ('good', 'bad_fix', 'not_working')),
    comment         TEXT,
    feedback_type   VARCHAR(50) NOT NULL DEFAULT 'user'
                    CHECK (feedback_type IN ('user', 'auto', 'escalation', 'rollback', 'retry')),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_feedback_run_id ON run_feedback(run_id);
CREATE INDEX IF NOT EXISTS idx_run_feedback_user_id ON run_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_run_feedback_verdict ON run_feedback(verdict);

COMMIT;
