-- Rollback: Remove webhook_events enrichment fields
-- Migration: 003_webhook_events_enrich

ALTER TABLE webhook_events DROP COLUMN IF EXISTS delivery_id;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS status;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS last_error;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS retry_count;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS processed_at;

DROP INDEX IF EXISTS idx_webhook_events_delivery;
DROP INDEX IF EXISTS idx_webhook_events_status;
DROP INDEX IF EXISTS idx_webhook_events_created;
