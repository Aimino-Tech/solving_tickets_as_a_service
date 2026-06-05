-- Update webhook_events table for reliability features
-- Migration: 002_webhook_events_reliability
-- 
-- This migration upgrades the webhook_events table from the initial schema
-- (which had a simple processed boolean) to the full reliability schema
-- with delivery tracking, status, retry count, and error recording.

-- First, add new columns if they don't exist (safe for idempotent runs)
DO $$
BEGIN
  -- Add delivery_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'delivery_id'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN delivery_id VARCHAR(255);
  END IF;

  -- Add status column (replaces the processed boolean)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'status'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'received';
  END IF;

  -- Add retry_count column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- Add last_error column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'last_error'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN last_error TEXT;
  END IF;

  -- Add processed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'processed_at'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN processed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Migrate existing data: set status based on the old processed boolean
UPDATE webhook_events SET status = 'processed' WHERE processed = TRUE AND status = 'received';
UPDATE webhook_events SET status = 'failed' WHERE processed = FALSE AND status = 'received' AND created_at < NOW() - INTERVAL '1 hour';

-- Drop the old processed column (safe now that status covers it)
ALTER TABLE webhook_events DROP COLUMN IF EXISTS processed;

-- Create index for idempotency lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery_source
  ON webhook_events(delivery_id, source);

-- Create index for status-based queries (retry worker)
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON webhook_events(status);

-- Create index for replay range queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at
  ON webhook_events(created_at DESC);
