-- Rollback 020_workspaces_tokens_mcp
DROP TABLE IF EXISTS mcp_api_keys CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
