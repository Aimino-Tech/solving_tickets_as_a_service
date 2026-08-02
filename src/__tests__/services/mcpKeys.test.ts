/**
 * Unit tests for the MCP API key service — src/services/mcpKeys.ts
 *
 * Tests: generateKey format, hashKey, createMcpKey (hash-only storage),
 * listMcpKeys, renameMcpKey, revokeMcpKey (soft-delete), findUserByMcpKey,
 * touchMcpKey (fire-and-forget).
 *
 * Strategy: mock db/connection.js (queryWithRetry) and the logger.
 */

import { describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockLoggerChild = vi.hoisted(() =>
  vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
);

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: mockLoggerChild },
}));

const mockQueryWithRetry = vi.hoisted(() => vi.fn());

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

// ── Suite ───────────────────────────────────────────────────────────────────

describe('mcpKeys service', () => {
  let mod: typeof import('../../services/mcpKeys.js');

  beforeAll(async () => {
    mod = await import('../../services/mcpKeys.js');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateKey', () => {
    it('returns a key with sk-stas_ prefix and 32 hex chars', () => {
      const { key, prefix } = mod.generateKey();
      expect(key).toMatch(/^sk-stas_[0-9a-f]{32}$/);
      // prefix = 'sk-stas_' + first 8 chars of the hex portion
      const hexStart = mod.MCP_KEY_PREFIX.length;
      expect(prefix).toBe(mod.MCP_KEY_PREFIX + key.slice(hexStart, hexStart + 8));
      expect(key.startsWith(prefix)).toBe(true);
    });

    it('generates unique keys across calls', () => {
      const { key: a } = mod.generateKey();
      const { key: b } = mod.generateKey();
      expect(a).not.toBe(b);
    });
  });

  describe('hashKey', () => {
    it('returns a 64-char sha256 hex digest', () => {
      const hash = mod.hashKey('sk-stas_abcdef');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      expect(mod.hashKey('sk-stas_xyz')).toBe(mod.hashKey('sk-stas_xyz'));
    });

    it('never returns the plaintext', () => {
      const key = 'sk-stas_secret123';
      expect(mod.hashKey(key)).not.toContain('secret123');
    });
  });

  describe('createMcpKey', () => {
    it('inserts the SHA-256 hash (never the plaintext) and returns record + key', async () => {
      const dbRow = {
        id: 'k-1',
        user_id: '42',
        name: 'agent',
        key_prefix: 'sk-stas_12345678',
        created_at: '2026-07-31T00:00:00.000Z',
        last_used_at: null,
        revoked_at: null,
      };
      mockQueryWithRetry.mockResolvedValue({ rows: [dbRow] });

      const { record, key } = await mod.createMcpKey('42', 'agent');

      expect(key).toMatch(/^sk-stas_/);
      // The INSERTed hash must be sha256(key), not the raw key
      const insertedParams = mockQueryWithRetry.mock.calls[0][1];
      expect(insertedParams[2]).toBe(mod.hashKey(key));
      expect(insertedParams[2]).not.toBe(key);
      expect(record).toEqual({
        id: 'k-1',
        userId: '42',
        name: 'agent',
        keyPrefix: 'sk-stas_12345678',
        createdAt: '2026-07-31T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
        revealable: false,
      });
    });
  });

  describe('listMcpKeys', () => {
    it('maps db rows to records ordered by created_at desc', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [
          { id: 'k2', user_id: '1', name: 'b', key_prefix: 'sk-stas_bbbbbbbb', created_at: '2026-07-31T01:00:00Z', last_used_at: null, revoked_at: null },
          { id: 'k1', user_id: '1', name: 'a', key_prefix: 'sk-stas_aaaaaaaa', created_at: '2026-07-31T00:00:00Z', last_used_at: '2026-07-30T00:00:00Z', revoked_at: null },
        ],
      });

      const keys = await mod.listMcpKeys('1');

      expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), ['1']);
      expect(keys).toHaveLength(2);
      expect(keys[0].id).toBe('k2');
      expect(keys[1].name).toBe('a');
      expect(keys[1].lastUsedAt).toBe('2026-07-30T00:00:00Z');
    });

    it('returns [] when the user has no keys', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      const keys = await mod.listMcpKeys('1');
      expect(keys).toEqual([]);
    });
  });

  describe('renameMcpKey', () => {
    it('updates the name and returns the record', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ id: 'k1', user_id: '1', name: 'renamed', key_prefix: 'sk-stas_aaaaaaaa', created_at: '2026-07-31T00:00:00Z', last_used_at: null, revoked_at: null }],
      });
      const record = await mod.renameMcpKey('1', 'k1', 'renamed');
      expect(record?.name).toBe('renamed');
      // WHERE id = $1 AND user_id = $2 — ownership enforced in SQL
      expect(mockQueryWithRetry.mock.calls[0][1]).toEqual(['k1', '1', 'renamed']);
    });

    it('returns null when the key does not belong to the user', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      const record = await mod.renameMcpKey('1', 'k-other', 'x');
      expect(record).toBeNull();
    });
  });

  describe('revokeMcpKey', () => {
    it('soft-deletes and returns true', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 'k1' }] });
      const ok = await mod.revokeMcpKey('1', 'k1');
      expect(ok).toBe(true);
      expect(mockQueryWithRetry.mock.calls[0][0]).toContain('revoked_at = NOW()');
      expect(mockQueryWithRetry.mock.calls[0][0]).toContain('revoked_at IS NULL');
    });

    it('returns false when nothing matched (not owner / already revoked)', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      const ok = await mod.revokeMcpKey('1', 'k-other');
      expect(ok).toBe(false);
    });
  });

  describe('findUserByMcpKey', () => {
    it('looks up by hash of the presented key and returns user context', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ id: 'k1', user_id: '7', name: 'agent' }],
      });
      const found = await mod.findUserByMcpKey('sk-stas_abc');
      expect(mockQueryWithRetry.mock.calls[0][1]).toEqual([mod.hashKey('sk-stas_abc')]);
      expect(found).toEqual({ userId: '7', keyId: 'k1', name: 'agent' });
    });

    it('returns null for unknown/revoked keys (no row)', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      const found = await mod.findUserByMcpKey('sk-stas_unknown');
      expect(found).toBeNull();
    });
  });

  describe('touchMcpKey', () => {
    it('fires an UPDATE and swallows errors (fire-and-forget)', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      await mod.touchMcpKey('k1');
      await new Promise((r) => setTimeout(r, 5));
      expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining('UPDATE mcp_api_keys SET last_used_at = NOW()'), ['k1']);
    });

    it('does not throw when the update fails', async () => {
      mockQueryWithRetry.mockRejectedValue(new Error('db down'));
      expect(() => mod.touchMcpKey('k1')).not.toThrow();
      // allow the rejected promise to settle through the .catch handler
      await new Promise((r) => setTimeout(r, 10));
      expect(mockQueryWithRetry).toHaveBeenCalled();
    });
  });
});

