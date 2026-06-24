/**
 * Unit tests for src/billing/usage.ts — Usage tracking per billing period.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedisClient = {
  zcount: vi.fn(), zadd: vi.fn(), expire: vi.fn(),
  pipeline: vi.fn(() => ({ zadd: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) })),
  del: vi.fn(), quit: vi.fn(), on: vi.fn(),
};

vi.mock('ioredis', () => ({ default: function() { return mockRedisClient; }, Redis: function() { return mockRedisClient; } }));
vi.mock('../../config.js', () => ({ config: { queue: { redisUrl: 'redis://localhost:6379' }, stripe: { soloPriceId: 'price_solo_mock', teamPriceId: 'price_team_mock' } } }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('billing/usage', () => {
  let usage: typeof import('../../billing/usage.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    usage = await import('../../billing/usage.js');
  });

  describe('buildUsageKey', () => {
    it('builds key from account ID and periodStart date', () => {
      const key = usage.buildUsageKey(42, new Date('2025-06-01T00:00:00Z'));
      expect(key).toContain('stas:billing:usage:42:2025-06');
    });
    it('falls back to current month when no periodStart', () => {
      expect(usage.buildUsageKey(42)).toContain('stas:billing:usage:42:');
    });
  });

  describe('getBillingUsage', () => {
    it('returns count from Redis', async () => {
      mockRedisClient.zcount.mockResolvedValue(5);
      expect(await usage.getBillingUsage(42)).toBe(5);
    });
    it('returns 0 on error', async () => {
      mockRedisClient.zcount.mockRejectedValue(new Error('down'));
      expect(await usage.getBillingUsage(42)).toBe(0);
    });
  });

  describe('getRemainingBillingUsage', () => {
    it('returns remaining for a plan', async () => {
      mockRedisClient.zcount.mockResolvedValue(30);
      expect(await usage.getRemainingBillingUsage(42, 'solo')).toBe(70);
    });
    it('returns limit for enterprise', async () => {
      expect(await usage.getRemainingBillingUsage(42, 'enterprise')).toBe(999_999);
    });
  });

  describe('hasExceededUsageLimit', () => {
    it('returns true when at limit', async () => {
      mockRedisClient.zcount.mockResolvedValue(10);
      expect(await usage.hasExceededUsageLimit(42, 'free')).toBe(true);
    });
    it('returns false when under limit', async () => {
      mockRedisClient.zcount.mockResolvedValue(3);
      expect(await usage.hasExceededUsageLimit(42, 'free')).toBe(false);
    });
    it('returns false for enterprise', async () => {
      expect(await usage.hasExceededUsageLimit(42, 'enterprise')).toBe(false);
    });
  });

  describe('isUsageAtThreshold', () => {
    it('returns true when at threshold', async () => {
      mockRedisClient.zcount.mockResolvedValue(8);
      expect(await usage.isUsageAtThreshold(42, 'free', 80)).toBe(true);
    });
  });

  describe('incrementBillingUsage', () => {
    it('uses pipeline', async () => {
      await usage.incrementBillingUsage(42);
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
    });
  });

  describe('resetBillingUsage', () => {
    it('deletes the key', async () => {
      await usage.resetBillingUsage(42);
      expect(mockRedisClient.del).toHaveBeenCalled();
    });
  });

  describe('checkUsageBeforeFix', () => {
    it('allows when under limit', async () => {
      mockRedisClient.zcount.mockResolvedValue(5);
      const r = await usage.checkUsageBeforeFix(42, 'solo');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(95);
    });
    it('blocks when over limit', async () => {
      mockRedisClient.zcount.mockResolvedValue(100);
      const r = await usage.checkUsageBeforeFix(42, 'solo');
      expect(r.allowed).toBe(false);
    });
  });
});
