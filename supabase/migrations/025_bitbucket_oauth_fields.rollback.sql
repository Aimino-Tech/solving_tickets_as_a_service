-- Rollback 025_bitbucket_oauth_fields
ALTER TABLE bitbucket_connections
  DROP COLUMN IF EXISTS token_expires_at,
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS bitbucket_uuid,
  DROP COLUMN IF EXISTS refresh_token_encrypted,
  DROP COLUMN IF EXISTS auth_method;
