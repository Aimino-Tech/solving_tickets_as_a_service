-- AIM-3610: Switch users.id from SERIAL to Supabase Auth UUID
-- Removes supabase_uid column, promotes it to primary key
BEGIN;

-- Fill NULL supabase_uid with generated UUIDs before promoting to PK
UPDATE users SET supabase_uid = gen_random_uuid()::text WHERE supabase_uid IS NULL;

-- Drop FK constraints referencing users.id (must drop before altering types)
ALTER TABLE github_oauth_tokens        DROP CONSTRAINT IF EXISTS github_oauth_tokens_user_id_fkey;
ALTER TABLE github_installations       DROP CONSTRAINT IF EXISTS github_installations_user_id_fkey;
ALTER TABLE github_webhook_configs     DROP CONSTRAINT IF EXISTS github_webhook_configs_user_id_fkey;
ALTER TABLE run_feedback               DROP CONSTRAINT IF EXISTS run_feedback_user_id_fkey;
ALTER TABLE notification_preferences   DROP CONSTRAINT IF EXISTS notification_preferences_user_id_fkey;
ALTER TABLE notification_history       DROP CONSTRAINT IF EXISTS notification_history_user_id_fkey;

-- Promote supabase_uid to id
ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE users ALTER COLUMN id TYPE UUID USING supabase_uid::uuid;
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users DROP COLUMN supabase_uid;
DROP INDEX IF EXISTS idx_users_supabase_uid;

-- Convert FK columns from INTEGER to UUID
ALTER TABLE github_oauth_tokens        ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
ALTER TABLE github_installations       ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
ALTER TABLE github_webhook_configs     ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
ALTER TABLE run_feedback               ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
ALTER TABLE notification_preferences   ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
ALTER TABLE notification_history       ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;

-- Re-create FK constraints referencing users.id
ALTER TABLE github_oauth_tokens        ADD CONSTRAINT github_oauth_tokens_user_id_fkey        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE github_installations       ADD CONSTRAINT github_installations_user_id_fkey       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE github_webhook_configs     ADD CONSTRAINT github_webhook_configs_user_id_fkey     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE run_feedback               ADD CONSTRAINT run_feedback_user_id_fkey                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notification_preferences   ADD CONSTRAINT notification_preferences_user_id_fkey    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notification_history       ADD CONSTRAINT notification_history_user_id_fkey        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
