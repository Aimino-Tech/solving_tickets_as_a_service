-- Enrich webhook_events with delivery tracking and status fields
-- Migration: 003_webhook_events_enrich
--
-- Adds: delivery_id, status, last_error, retry_count, processed_at
-- Enables webhook replay and dead-letter tracking.

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS delivery_id VARCHAR(255);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'received';
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Migrate existing data: set status based on processed flag
UPDATE webhook_events SET status = 'processed' WHERE processed = true AND status = 'received';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery ON webhook_events(delivery_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at DESC);
