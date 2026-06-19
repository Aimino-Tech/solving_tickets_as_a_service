-- Add extended metadata fields for webhook event auditing
-- Migration: 004_webhook_events_extended_fields
--
-- This migration adds the remaining fields specified in the webhook event
-- log requirements:
--   1. installation_id — GitHub App installation or equivalent tracker ID
--   2. repo — Full repo name (e.g., "owner/repo")
--   3. raw_body_snippet — First 1KB of raw webhook body for debugging
--   4. headers — JSONB of relevant HTTP headers for forensic analysis

DO $$
BEGIN
  -- Add installation_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'installation_id'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN installation_id VARCHAR(255);
  END IF;

  -- Add repo column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'repo'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN repo VARCHAR(255);
  END IF;

  -- Add raw_body_snippet column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'raw_body_snippet'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN raw_body_snippet TEXT;
  END IF;

  -- Add headers column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name = 'headers'
  ) THEN
    ALTER TABLE webhook_events ADD COLUMN headers JSONB;
  END IF;
END $$;

-- Create index for installation_id lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_installation
  ON webhook_events(installation_id)
  WHERE installation_id IS NOT NULL;

-- Create index for repo-based filtering
CREATE INDEX IF NOT EXISTS idx_webhook_events_repo
  ON webhook_events(repo)
  WHERE repo IS NOT NULL;
