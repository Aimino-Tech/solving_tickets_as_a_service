-- AIM-3523: Notification preferences and history tables
-- Migration: 014_notifications
--
-- Stores per-user notification channel preferences (opt-in/out per event type)
-- and a persistent history of all sent notifications for the in-app bell.
-- Channel types: slack, email, discord, webhook, in_app
-- Event types: fix_started, pr_created, fix_completed, review_needed, etc.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_preferences (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         VARCHAR(50) NOT NULL
                    CHECK (channel IN ('email','slack','discord','webhook','in_app')),
    event_type      VARCHAR(50) NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    channel_target  VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, channel, event_type)
);

-- notification_history is created in 014_notification_history.sql
-- Add the `read` column and indexes if not present (required by notificationHistory.ts type)
ALTER TABLE notification_history ADD COLUMN IF NOT EXISTS read BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notif_history_user_read
    ON notification_history(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id
    ON notification_preferences(user_id);

COMMIT;
