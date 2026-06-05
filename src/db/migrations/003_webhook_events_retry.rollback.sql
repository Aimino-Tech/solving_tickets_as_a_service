-- Rollback 003_webhook_events_retry

DROP INDEX IF EXISTS idx_webhook_events_source;
DROP INDEX IF EXISTS idx_webhook_events_retry_poll;
DROP INDEX IF EXISTS uq_webhook_events_delivery_source;

-- Recreate the old index for backward compat
CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery_source
  ON webhook_events(delivery_id, source);

ALTER TABLE webhook_events DROP COLUMN IF EXISTS next_retry_at;
