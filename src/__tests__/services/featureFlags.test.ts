/**
 * Unit tests for src/services/featureFlags.ts — Feature flag resolution.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockRedis = {
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  zadd: vi.fn().mockResolvedValue(1),
  zremrangebyscore: vi.fn().mockResolvedValue(0),
  zcard: vi.fn().mockResolvedValue(0),
  expire: vi.fn().mockResolvedValue(1),
};
vi.mock('ioredis', () => ({ default: function() { return mockRedis; }, Redis: function() { return mockRedis; } }));

const mockQuery = vi.fn();
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));

const mockAuditInsert = vi.fn().mockResolvedValue({ id: 1 });
vi.mock('../../audit/repository.js', () => ({
  auditRepository: { insert: mockAuditInsert },
}));

vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
    featureFlags: { defaultTtlSeconds: 300, autoDisableThreshold: 0.05 },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../featureFlags/metrics.js', () => ({
  recordFeatureFlagEvaluation: vi.fn(),
  recordFeatureFlagOverride: vi.fn(),
}));

describe('services/featureFlags', () => {
  let ff: typeof import('../../services/featureFlags.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-apply default mock return values after clearAllMocks
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.quit.mockResolvedValue(undefined);
    ff = await import('../../services/featureFlags.js');
  });

  afterEach(() => {
    delete process.env.FLAG_TEST_FLAG;
    vi.unstubAllEnvs();
  });

  // ── Error rate tracking ──────────────────────────────────────────────────

  describe('recordFlagCall', () => {
    it('adds a timestamped entry to the calls sorted set', async () => {
      await ff.recordFlagCall('test_flag');
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'stas:flags:metrics:test_flag:calls',
        expect.any(Number),
        expect.any(String),
      );
    });

    it('sets expiry on the calls key', async () => {
      await ff.recordFlagCall('test_flag');
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'stas:flags:metrics:test_flag:calls',
        expect.any(Number),
      );
    });
  });

  describe('recordFlagError', () => {
    it('adds a timestamped entry to the errors sorted set', async () => {
      await ff.recordFlagError('test_flag');
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'stas:flags:metrics:test_flag:errors',
        expect.any(Number),
        expect.any(String),
      );
    });

    it('sets expiry on the errors key', async () => {
      await ff.recordFlagError('test_flag');
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'stas:flags:metrics:test_flag:errors',
        expect.any(Number),
      );
    });
  });

  describe('getErrorRate', () => {
    it('returns 0 when no calls recorded', async () => {
      mockRedis.zcard.mockResolvedValue(0);
      const rate = await ff.getErrorRate('test_flag');
      expect(rate).toBe(0);
    });

    it('prunes old entries before counting', async () => {
      mockRedis.zcard.mockResolvedValue(10);
      await ff.getErrorRate('test_flag');
      expect(mockRedis.zremrangebyscore).toHaveBeenCalledTimes(2);
    });

    it('calculates errors / calls ratio', async () => {
      mockRedis.zcard
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(5);
      const rate = await ff.getErrorRate('test_flag');
      expect(rate).toBe(0.05);
    });

    it('returns 0 gracefully on Redis error', async () => {
      mockRedis.zcard.mockRejectedValue(new Error('Redis down'));
      const rate = await ff.getErrorRate('test_flag');
      expect(rate).toBe(0);
    });
  });

  describe('checkAndAutoDisable', () => {
    it('disables flag globally when error rate exceeds threshold', async () => {
      mockRedis.zcard
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(20);
      mockQuery.mockResolvedValue({ rowCount: 1 });

      const result = await ff.checkAndAutoDisable('test_flag');
      expect(result).toBe(true);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feature_flags'),
        ['test_flag', false, 0],
      );
    });

    it('logs audit entry when auto-disabling', async () => {
      mockRedis.zcard
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(20);
      mockQuery.mockResolvedValue({ rowCount: 1 });

      await ff.checkAndAutoDisable('test_flag');
      expect(mockAuditInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'feature_flag.auto_disabled',
          resourceId: 'test_flag',
          details: expect.objectContaining({ errorRate: 0.2, threshold: 0.05 }),
        }),
      );
    });

    it('does nothing when error rate is below threshold', async () => {
      mockRedis.zcard
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(1);

      const result = await ff.checkAndAutoDisable('test_flag');
      expect(result).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does nothing when no calls recorded', async () => {
      mockRedis.zcard.mockResolvedValue(0);

      const result = await ff.checkAndAutoDisable('test_flag');
      expect(result).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── Flag resolution ──────────────────────────────────────────────────────

  describe('isFeatureEnabled', () => {
    it('returns true from account-level DB flag', async () => {
      mockRedis.zcard.mockResolvedValue(0);
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
      mockRedis.zcard.mockResolvedValue(0);
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

    it('auto-disables and returns false when error rate exceeds threshold', async () => {
      mockRedis.zcard
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(20);
      mockQuery.mockResolvedValue({ rows: [{ enabled: true }] });
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await ff.isFeatureEnabled('test_flag', 42);
      expect(result).toBe(false);
    });

    it('does not check auto-disable for env-var flags', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      process.env.FLAG_TEST_FLAG = 'true';

      const result = await ff.isFeatureEnabled('test_flag', 42);
      expect(result).toBe(true);
      expect(mockRedis.zcard).not.toHaveBeenCalled();
    });
  });

  describe('setFeatureFlag', () => {
    it('sets account-level flag', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.setFeatureFlag('test_flag', true, 42);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feature_flags'),
        [42, 'test_flag', true, 0],
      );
    });

    it('sets global flag when no accountId', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.setFeatureFlag('test_flag', false);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feature_flags'),
        ['test_flag', false, 0],
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

  describe('enabledFor', () => {
    it('returns true from account-level DB flag', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockQuery.mockResolvedValue({ rows: [{ enabled: true, percentage_rollout: 0 }] });
      const result = await ff.enabledFor('test_flag', 42);
      expect(result).toBe(true);
    });

    it('returns false from account-level DB flag', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockQuery.mockResolvedValue({ rows: [{ enabled: false, percentage_rollout: 0 }] });
      const result = await ff.enabledFor('test_flag', 42);
      expect(result).toBe(false);
    });

    it('uses percentage rollout when set on global flag', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true, percentage_rollout: 100 }] });
      const result = await ff.enabledFor('rollout_flag', 42);
      expect(result).toBe(true);
    });

    it('returns false when hash exceeds percentage', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false, percentage_rollout: 50 }] });
      // With 50% rollout, about half the accounts should get it
      const results = new Set<boolean>();
      for (let i = 1; i <= 50; i++) {
        mockRedis.get.mockResolvedValue(null);
        mockQuery.mockResolvedValueOnce({ rows: [] });
        mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false, percentage_rollout: 50 }] });
        results.add(await ff.enabledFor('rollout_flag', i));
      }
      expect(results.has(true)).toBe(true);
      expect(results.has(false)).toBe(true);
    });
  });

  describe('hashPercentage', () => {
    it('returns a value between 0 and 99', () => {
      for (let i = 1; i <= 100; i++) {
        const hash = ff.hashPercentage('test_flag', i);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThan(100);
      }
    });

    it('returns the same value for same inputs', () => {
      const hash1 = ff.hashPercentage('test_flag', 42);
      const hash2 = ff.hashPercentage('test_flag', 42);
      expect(hash1).toBe(hash2);
    });

    it('returns different values for different accountIds', () => {
      const hash1 = ff.hashPercentage('test_flag', 1);
      const hash2 = ff.hashPercentage('test_flag', 2);
      expect(hash1).not.toBe(hash2);
    });

    it('returns different values for different flags', () => {
      const hash1 = ff.hashPercentage('flag_a', 42);
      const hash2 = ff.hashPercentage('flag_b', 42);
      expect(hash1).not.toBe(hash2);
    });

    it('distributes roughly evenly across 100 buckets', () => {
      const buckets = new Array(100).fill(0);
      for (let i = 1; i <= 5000; i++) {
        const hash = ff.hashPercentage('uniform_test', i);
        buckets[hash]++;
      }
      const avg = 5000 / 100;
      const maxDeviation = buckets.reduce((max, count) => Math.max(max, Math.abs(count - avg)), 0);
      expect(maxDeviation / avg).toBeLessThan(0.5);
    });
  });

  describe('invalidateCache', () => {
    it('deletes the cache key', async () => {
      await ff.invalidateCache('test_flag', 42);
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('stas:flags:account:42:test_flag'));
    });

    it('deletes global cache key when no accountId', async () => {
      await ff.invalidateCache('test_flag');
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('stas:flags:global:test_flag'));
    });
  });

  describe('setAccountOverride', () => {
    it('creates account-level flag', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.setAccountOverride('test_flag', 42, true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feature_flags'),
        [42, 'test_flag', true, 0],
      );
    });
  });

  describe('removeAccountOverride', () => {
    it('deletes account-level flag and invalidates cache', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await ff.removeAccountOverride('test_flag', 42);
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM feature_flags'),
        ['test_flag', 42],
      );
    });
  });
});
