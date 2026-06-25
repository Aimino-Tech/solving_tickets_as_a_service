-- Rollback 007_slo_metrics: drop health_checks and request_timing tables
-- Migration: 007_slo_metrics

BEGIN;

DROP TABLE IF EXISTS request_timing;
DROP TABLE IF EXISTS health_checks;

COMMIT;
