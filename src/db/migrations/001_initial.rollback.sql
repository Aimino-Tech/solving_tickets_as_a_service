-- Rollback initial schema
-- Migration: 001_initial

DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS run_history;
DROP TABLE IF EXISTS usage_records;
DROP TABLE IF EXISTS credit_transactions;
DROP TABLE IF EXISTS credit_balances;
DROP TABLE IF EXISTS accounts;
