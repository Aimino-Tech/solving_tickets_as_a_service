-- Rollback: MCP key encrypted-at-rest column (migration 021)
ALTER TABLE mcp_api_keys DROP COLUMN IF EXISTS key_encrypted;
