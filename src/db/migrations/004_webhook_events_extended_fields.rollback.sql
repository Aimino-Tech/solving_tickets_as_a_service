-- Rollback 004_webhook_events_extended_fields

DROP INDEX IF EXISTS idx_webhook_events_repo;
DROP INDEX IF EXISTS idx_webhook_events_installation;

ALTER TABLE webhook_events DROP COLUMN IF EXISTS headers;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS raw_body_snippet;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS repo;
ALTER TABLE webhook_events DROP COLUMN IF EXISTS installation_id;
