BEGIN;

DROP INDEX IF EXISTS idx_run_feedback_verdict;
DROP INDEX IF EXISTS idx_run_feedback_user_id;
DROP INDEX IF EXISTS idx_run_feedback_run_id;
DROP TABLE IF EXISTS run_feedback;

COMMIT;
