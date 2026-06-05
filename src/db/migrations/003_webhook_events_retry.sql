-- Add retry scheduling and idempotency enforcement for webhook events
-- Migration: 003_webhook_events_retry
--
-- This migration adds:
--   1. next_retry_at column for scheduling retry attempts
--   2. Unique index on (delivery_id, source) for idempotency
--   3. Index for retry worker polling queries

DO $$
BEGIN
  -- Add next_retry_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'next_retry_at'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN next_retry_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add unique index on (delivery_id, source) for idempotency (only non-null delivery_id)
DROP INDEX IF EXISTS idx_webhook_events_delivery_source;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_delivery_source
  ON webhook_events(delivery_id, source)
  WHERE delivery_id IS NOT NULL;

-- Create index for retry worker polling (status + next_retry_at)
CREATE INDEX IF NOT EXISTS idx_webhook_events_retry_poll
  ON webhook_events(status, next_retry_at)
  WHERE status IN ('received', 'failed');

-- Create index for source-based filtering
CREATE INDEX IF NOT EXISTS idx_webhook_events_source
  ON webhook_events(source);
