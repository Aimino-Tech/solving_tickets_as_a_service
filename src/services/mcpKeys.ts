/**
 * MCP API key service — per-user API keys for agent access via MCP.
 *
 * Keys are generated as `sk-stas_<32 hex>` and stored as a SHA-256 hash
 * (key_hash, for lookup) plus an AES-256-GCM encrypted copy (key_encrypted,
 * so the Settings UI can reveal the full key on demand).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mcp-keys' });

export const MCP_KEY_PREFIX = 'sk-stas_';

export interface McpApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** true when the full key can be revealed (created after encrypted storage was added). */
  revealable: boolean;
}

interface DbKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  key_encrypted: string | null;
}

function rowToRecord(row: DbKeyRow): McpApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revealable: !!row.key_encrypted,
  };
}

/** Generate a new key: `sk-stas_` + 32 hex chars. */
export function generateKey(): { key: string; prefix: string } {
  const key = `${MCP_KEY_PREFIX}${randomBytes(16).toString('hex')}`;
  return { key, prefix: key.slice(0, MCP_KEY_PREFIX.length + 8) };
}

/** SHA-256 hash of a key — used for lookup (never reversible). */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** AES-256-GCM key derived from the server JWT secret (stable, 32 bytes). */
function deriveEncryptionKey(): Buffer {
  return scryptSync(config.auth.jwtSecret, 'stas-mcp-key-encryption', 32);
}

/** Encrypt a key at rest. Returns `${ivBase64}:${authTag+ciphertextBase64}`. */
function encryptKey(key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${Buffer.concat([authTag, encrypted]).toString('base64')}`;
}

/** Decrypt a key previously stored by encryptKey. Returns null on failure. */
function decryptKey(payload: string): string | null {
  try {
    const [ivB64, dataB64] = payload.split(':');
    if (!ivB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const authTag = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    const decipher = createDecipheriv('aes-256-gcm', deriveEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export async function createMcpKey(userId: string, name: string): Promise<{ record: McpApiKeyRecord; key: string }> {
  const { key, prefix } = generateKey();
  const keyHash = hashKey(key);
  const keyEncrypted = encryptKey(key);
  const result = await queryWithRetry<DbKeyRow>(
    `INSERT INTO mcp_api_keys (user_id, name, key_hash, key_prefix, key_encrypted)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, name, keyHash, prefix, keyEncrypted],
  );
  const record = rowToRecord(result.rows[0]);
  log.info({ keyId: record.id, userId }, 'MCP API key created');
  return { record, key };
}

export async function listMcpKeys(userId: string): Promise<McpApiKeyRecord[]> {
  const result = await queryWithRetry<DbKeyRow>(
    `SELECT id, user_id, name, key_prefix, created_at, last_used_at, revoked_at, key_encrypted
     FROM mcp_api_keys
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(rowToRecord);
}

export async function renameMcpKey(userId: string, keyId: string, name: string): Promise<McpApiKeyRecord | null> {
  const result = await queryWithRetry<DbKeyRow>(
    `UPDATE mcp_api_keys
     SET name = $3
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [keyId, userId, name],
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

/** Soft-delete a key (revoked_at). Returns false if the key does not belong to the user. */
export async function revokeMcpKey(userId: string, keyId: string): Promise<boolean> {
  const result = await queryWithRetry<DbKeyRow>(
    `UPDATE mcp_api_keys
     SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [keyId, userId],
  );
  if (result.rows[0]) log.info({ keyId, userId }, 'MCP API key revoked');
  return result.rows.length > 0;
}

/**
 * Reveal the plaintext of a key owned by the user. Returns null when the key
 * is not found, belongs to another user, is revoked, or predates encrypted
 * storage (legacy rows have no key_encrypted and cannot be revealed).
 */
export async function getMcpKeyPlaintext(userId: string, keyId: string): Promise<string | null> {
  const result = await queryWithRetry<{ key_encrypted: string | null }>(
    `SELECT key_encrypted
     FROM mcp_api_keys
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [keyId, userId],
  );
  const row = result.rows[0];
  if (!row?.key_encrypted) return null;
  return decryptKey(row.key_encrypted);
}

/**
 * Resolve a raw key to a user, or null when invalid/revoked/unknown.
 * Used by mcpKeyAuth on the MCP surfaces.
 */
export async function findUserByMcpKey(key: string): Promise<{ userId: string; keyId: string; name: string } | null> {
  const keyHash = hashKey(key);
  const result = await queryWithRetry<{ id: string; user_id: string; name: string }>(
    `SELECT id, user_id, name
     FROM mcp_api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [keyHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { userId: row.user_id, keyId: row.id, name: row.name };
}

/** Fire-and-forget last_used_at update (never blocks the request). */
export function touchMcpKey(keyId: string): void {
  queryWithRetry('UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = $1', [keyId]).catch((err) => {
    log.warn({ err: String(err), keyId }, 'Failed to update MCP key last_used_at');
  });
}
