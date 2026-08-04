-- AIM-3610: Switch users.id from SERIAL to Supabase Auth UUID
-- Removes supabase_uid column, promotes it to primary key
-- Idempotent: no-op when users.id is already UUID (supabase/013_users applied first).
BEGIN;

DO $$
BEGIN
  -- Already on UUID PK (canonical Supabase shape) — nothing to do
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    RETURN;
  END IF;

  -- Fill NULL supabase_uid with generated UUIDs before promoting to PK
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'supabase_uid'
  ) THEN
    UPDATE users SET supabase_uid = gen_random_uuid()::text WHERE supabase_uid IS NULL;
  ELSE
    ALTER TABLE users ADD COLUMN supabase_uid VARCHAR(255) UNIQUE;
    UPDATE users SET supabase_uid = gen_random_uuid()::text WHERE supabase_uid IS NULL;
  END IF;

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
  ALTER TABLE users DROP COLUMN IF EXISTS supabase_uid;
  DROP INDEX IF EXISTS idx_users_supabase_uid;

  -- Convert FK columns from INTEGER to UUID when still integer-typed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'github_oauth_tokens'
      AND column_name = 'user_id' AND data_type IN ('integer', 'bigint')
  ) THEN
    ALTER TABLE github_oauth_tokens ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'github_installations'
      AND column_name = 'user_id' AND data_type IN ('integer', 'bigint')
  ) THEN
    ALTER TABLE github_installations ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'github_webhook_configs'
      AND column_name = 'user_id' AND data_type IN ('integer', 'bigint')
  ) THEN
    ALTER TABLE github_webhook_configs ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'run_feedback'
      AND column_name = 'user_id' AND data_type IN ('integer', 'bigint')
  ) THEN
    ALTER TABLE run_feedback ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_preferences'
      AND column_name = 'user_id' AND data_type IN ('integer', 'bigint')
  ) THEN
    ALTER TABLE notification_preferences ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_history'
      AND column_name = 'user_id' AND data_type IN ('integer', 'bigint')
  ) THEN
    ALTER TABLE notification_history ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
  END IF;

  -- Re-create FK constraints referencing users.id
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_oauth_tokens') THEN
    ALTER TABLE github_oauth_tokens
      DROP CONSTRAINT IF EXISTS github_oauth_tokens_user_id_fkey,
      ADD CONSTRAINT github_oauth_tokens_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_installations') THEN
    ALTER TABLE github_installations
      DROP CONSTRAINT IF EXISTS github_installations_user_id_fkey,
      ADD CONSTRAINT github_installations_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'github_webhook_configs') THEN
    ALTER TABLE github_webhook_configs
      DROP CONSTRAINT IF EXISTS github_webhook_configs_user_id_fkey,
      ADD CONSTRAINT github_webhook_configs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'run_feedback') THEN
    ALTER TABLE run_feedback
      DROP CONSTRAINT IF EXISTS run_feedback_user_id_fkey,
      ADD CONSTRAINT run_feedback_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    ALTER TABLE notification_preferences
      DROP CONSTRAINT IF EXISTS notification_preferences_user_id_fkey,
      ADD CONSTRAINT notification_preferences_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_history') THEN
    ALTER TABLE notification_history
      DROP CONSTRAINT IF EXISTS notification_history_user_id_fkey,
      ADD CONSTRAINT notification_history_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
