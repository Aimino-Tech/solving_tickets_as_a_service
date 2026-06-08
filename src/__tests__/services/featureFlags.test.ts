/**
 * Unit tests for src/services/featureFlags.ts — Feature flag resolution.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedis = { on: vi.fn(), quit: vi.fn() };
vi.mock('ioredis', () => ({ default: vi.fn(() => mockRedis), Redis: vi.fn(() => mockRedis) }));

const mockQuery = vi.fn();
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));

vi.mock('../../config.js', () => ({
  config: { queue: { redisUrl: 'redis://localhost:6379' }, featureFlags: { defaultTtlSeconds: 300 } },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('services/featureFlags', () => {
  let ff: typeof import('../../services/featureFlags.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    ff = await import('../../services/featureFlags.js');
  });

  describe('isFeatureEnabled', () => {
    it('returns true from account-level DB flag', async () => {
      mockQuery.mockResolvedValue({ rows: [{ enabled: true }] });
      const result = await ff.isFeatureEnabled('test_flag', 42);
      expect(result).toBe(true);
    });

    it('returns false from account-level DB flag', async () => {
      mockQuery.mockResolvedValue({ rows: [{ enabled: false }] });
      const result = await ff.isFeatureEnabled('test_flag', 42);
      expect(result).toBe(false);
    });

    it('falls back to global DB flag when no account-level', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true }] });
      const result = await ff.isFeatureEnabled('test_flag', 42);
      expect(result).toBe(true);
    });

    it('falls back to env var when no DB flags', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      process.env.FLAG_TEST_FLAG = 'true';
      const result = await ff.isFeatureEnabled('test_flag', 42);
      expect(result).toBe(true);
      delete process.env.FLAG_TEST_FLAG;
    });

    it('returns false when no flag source found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const result = await ff.isFeatureEnabled('nonexistent_flag');
      expect(result).toBe(false);
    });

    it('returns false on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB down'));
      const result = await ff.isFeatureEnabled('test_flag');
      expect(result).toBe(false);
    });
  });

  describe('setFeatureFlag', () => {
    it('sets account-level flag', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.setFeatureFlag('test_flag', true, 42);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feature_flags'),
        [42, 'test_flag', true],
      );
    });

    it('sets global flag when no accountId', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.setFeatureFlag('test_flag', false);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feature_flags'),
        ['test_flag', false],
      );
    });
  });

  describe('deleteFeatureFlag', () => {
    it('deletes account-level flag', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.deleteFeatureFlag('test_flag', 42);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM feature_flags'),
        ['test_flag', 42],
      );
    });

    it('deletes global flag', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.deleteFeatureFlag('test_flag');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM feature_flags'),
        ['test_flag'],
      );
    });
  });

  describe('listFeatureFlags', () => {
    it('lists flags for account', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ flag: 'test', enabled: true, account_id: 42 }],
      });
      const flags = await ff.listFeatureFlags(42);
      expect(flags).toHaveLength(1);
      expect(flags[0].flag).toBe('test');
    });

    it('lists all flags globally', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { flag: 'flag_a', enabled: true, account_id: null },
          { flag: 'flag_b', enabled: false, account_id: null },
        ],
      });
      const flags = await ff.listFeatureFlags();
      expect(flags).toHaveLength(2);
    });

    it('returns empty array on error', async () => {
      mockQuery.mockRejectedValue(new Error('DB down'));
      const flags = await ff.listFeatureFlags();
      expect(flags).toEqual([]);
    });
  });
});
