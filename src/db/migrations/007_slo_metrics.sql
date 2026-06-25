-- AIM-1964: Tables for SLO metric collection (health_checks, request_timing)
-- Migration: 007_slo_metrics
--
-- Creates:
--   health_checks  — Records periodic health check results for uptime SLO
--   request_timing — Tracks API request durations for latency SLOs

BEGIN;

-- -----------------------------------------------------------------------
-- 1. Health checks table — stores periodic health probe results
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_checks (
    id              SERIAL PRIMARY KEY,
    status          VARCHAR(20) NOT NULL DEFAULT 'healthy',
    response_time_ms INTEGER,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at
    ON health_checks(checked_at DESC);

-- -----------------------------------------------------------------------
-- 2. Request timing table — records per-request latency data
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_timing (
    id              SERIAL PRIMARY KEY,
    method          VARCHAR(10),
    path            VARCHAR(500),
    status_code     INTEGER,
    duration_ms     INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_timing_created
    ON request_timing(created_at DESC);

COMMIT;
