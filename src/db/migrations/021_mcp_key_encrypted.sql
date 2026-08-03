-- Store the plaintext MCP API key encrypted-at-rest (AES-256-GCM) so the
-- Settings UI can offer a show/hide (reveal) toggle.
-- Migration: 021_mcp_key_encrypted
-- NOTE: legacy rows (created before this migration) have key_encrypted = NULL
-- and cannot be revealed — only newly created keys are stored encrypted.

ALTER TABLE mcp_api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT;
