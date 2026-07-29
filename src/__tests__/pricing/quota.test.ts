/**
 * Unit tests for src/pricing/quota.ts — Monthly fix-quota management.
 *
 * Coverage:
 *   - buildQuotaKey format
 *   - getMonthlyUsage / getRemainingQuota
 *   - incrementUsage
 *   - resetAccountQuota / resetMonthlyQuotas
 *   - getGlobalMonthlyUsage
 *   - Edge cases: enterprise tier unlimited, Redis failure
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// We mock config and ioredis before importing
vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
    stas: { monthlyQuotaEnabled: true },
  },
}));

// Create a mock Redis client factory that we can control
const mockRedisClient = vi.hoisted(() => {
  const client = {  zcount: vi.fn(),
  zadd: vi.fn(),
  expire: vi.fn(),
  pipeline: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
  zcard: vi.fn(),
  srem: vi.fn(),
  scard: vi.fn(),
  smembers: vi.fn(),
  sismember: vi.fn(),
  hget: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  lpush: vi.fn(),
  ltrim: vi.fn(),
  lrange: vi.fn(),
  sadd: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  };

  // Make pipeline return a self-referencing mock
  client.pipeline.mockReturnValue({
    zadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    lpush: vi.fn().mockReturnThis(),
    ltrim: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]]),
  });

  return client;
});

vi.mock('ioredis', () => ({
  default: vi.fn(function () { return mockRedisClient; }),
  Redis: vi.fn(function () { return mockRedisClient; }),
}));

import {
  buildQuotaKey,
  getMonthlyUsage,
  getRemainingQuota,
  incrementUsage,
  resetAccountQuota,
  resetMonthlyQuotas,
  getGlobalMonthlyUsage,
} from '../../pricing/quota.js';

describe('buildQuotaKey', () => {
  it('returns correct key format for a given date', () => {
    const date = new Date('2026-06-05T12:00:00Z');
    expect(buildQuotaKey(12345, date)).toBe('stas:quotas:12345:2026-06');
  });

  it('pads month to two digits', () => {
    const date = new Date('2026-01-15T00:00:00Z');
    expect(buildQuotaKey(1, date)).toBe('stas:quotas:1:2026-01');
  });

  it('uses current date when no date provided', () => {
    const key = buildQuotaKey(999);
    expect(key).toMatch(/^stas:quotas:999:\d{4}-\d{2}$/);
  });
});

describe('getMonthlyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.zcount.mockReset();
  });

  it('returns usage count from Redis', async () => {
    mockRedisClient.zcount.mockResolvedValue(5);
    const usage = await getMonthlyUsage(12345);
    expect(usage).toBe(5);
  });

  it('returns 0 on Redis error', async () => {
    mockRedisClient.zcount.mockRejectedValue(new Error('Redis down'));
    const usage = await getMonthlyUsage(12345);
    expect(usage).toBe(0);
  });

  it('returns 0 when no usage exists', async () => {
    mockRedisClient.zcount.mockResolvedValue(0);
    const usage = await getMonthlyUsage(99999);
    expect(usage).toBe(0);
  });
});

describe('getRemainingQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.zcount.mockReset();
  });

  it('returns quota minus usage for free tier', async () => {
    mockRedisClient.zcount.mockResolvedValue(3);
    const remaining = await getRemainingQuota(12345, 'free');
    expect(remaining).toBe(47); // 50 - 3
  });

  it('returns quota minus usage for pro tier', async () => {
    mockRedisClient.zcount.mockResolvedValue(50);
    const remaining = await getRemainingQuota(12345, 'pro');
    expect(remaining).toBe(50); // 100 - 50
  });

  it('returns full quota for enterprise without Redis call', async () => {
    const remaining = await getRemainingQuota(12345, 'enterprise');
    expect(remaining).toBe(999_999);
    expect(mockRedisClient.zcount).not.toHaveBeenCalled();
  });

  it('returns 0 when usage exceeds quota', async () => {
    mockRedisClient.zcount.mockResolvedValue(55);
    const remaining = await getRemainingQuota(12345, 'free');
    expect(remaining).toBe(0);
  });

  it('returns full quota on Redis error', async () => {
    mockRedisClient.zcount.mockRejectedValue(new Error('Redis down'));
    const remaining = await getRemainingQuota(12345, 'pro');
    expect(remaining).toBe(100);
  });
});

describe('incrementUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records usage via Redis pipeline', async () => {
    await expect(incrementUsage(12345)).resolves.toBeUndefined();
  });

  it('handles Redis error gracefully', async () => {
    mockRedisClient.pipeline.mockReturnValue({
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('Pipeline failed')),
    });
    await expect(incrementUsage(12345)).resolves.toBeUndefined();
  });
});

describe('resetAccountQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.del.mockReset();
  });

  it('deletes the account quota key', async () => {
    mockRedisClient.del.mockResolvedValue(1);
    await expect(resetAccountQuota(12345)).resolves.toBeUndefined();
    expect(mockRedisClient.del).toHaveBeenCalled();
  });

  it('handles Redis error gracefully', async () => {
    mockRedisClient.del.mockRejectedValue(new Error('Redis down'));
    await expect(resetAccountQuota(12345)).resolves.toBeUndefined();
  });
});

describe('resetMonthlyQuotas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.scan.mockReset();
    mockRedisClient.del.mockReset();
  });

  it('scans and deletes all quota keys', async () => {
    mockRedisClient.scan
      .mockResolvedValueOnce(['0', ['stas:quotas:12345:2026-06', 'stas:quotas:67890:2026-06']]);
    mockRedisClient.del.mockResolvedValue(2);

    await expect(resetMonthlyQuotas()).resolves.toBeUndefined();
    expect(mockRedisClient.del).toHaveBeenCalledWith('stas:quotas:12345:2026-06', 'stas:quotas:67890:2026-06');
  });

  it('handles empty scan result', async () => {
    mockRedisClient.scan.mockResolvedValueOnce(['0', []]);
    await expect(resetMonthlyQuotas()).resolves.toBeUndefined();
  });

  it('handles Redis error gracefully', async () => {
    mockRedisClient.scan.mockRejectedValue(new Error('SCAN failed'));
    await expect(resetMonthlyQuotas()).resolves.toBeUndefined();
  });
});

describe('getGlobalMonthlyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.scan.mockReset();
    mockRedisClient.zcard.mockReset();
  });

  it('sums usage across all accounts', async () => {
    mockRedisClient.scan.mockResolvedValueOnce(['0', ['stas:quotas:1:2026-06', 'stas:quotas:2:2026-06']]);
    mockRedisClient.zcard.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

    const total = await getGlobalMonthlyUsage();
    expect(total).toBe(8);
  });

  it('returns 0 on Redis error', async () => {
    mockRedisClient.scan.mockRejectedValue(new Error('SCAN failed'));
    const total = await getGlobalMonthlyUsage();
    expect(total).toBe(0);
  });
});
