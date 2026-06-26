-- Rollback AIM-1999: Pipeline Run History

BEGIN;

DROP TABLE IF EXISTS pipeline_stage_events;
DROP TABLE IF EXISTS pipeline_runs;

COMMIT;
