-- Rollback webhook events reliability migration
-- Migration: 002_webhook_events_reliability

DROP INDEX IF EXISTS idx_webhook_events_created_at;
DROP INDEX IF EXISTS idx_webhook_events_status;
DROP INDEX IF EXISTS idx_webhook_events_delivery_source;

ALTER TABLE webhook_events DROP COLUMN IF EXISTS processed_at;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS last_error;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS retry_count;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS status;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS delivery_id;

ALTER TABLE webhook_events ADD COLUMN processed BOOLEAN NOT NULL DEFAULT FALSE;
