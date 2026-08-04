-- Rollback 019_oauth_notifications
DROP TABLE IF EXISTS notification_history CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS slack_oauth_tokens CASCADE;
DROP TABLE IF EXISTS linear_oauth_tokens CASCADE;
DROP TABLE IF EXISTS github_webhook_configs CASCADE;
DROP TABLE IF EXISTS github_installations CASCADE;
DROP TABLE IF EXISTS github_oauth_tokens CASCADE;
