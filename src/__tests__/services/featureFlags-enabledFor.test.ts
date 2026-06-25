import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  on: vi.fn(),
  quit: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  zadd: vi.fn().mockResolvedValue(1),
  zremrangebyscore: vi.fn().mockResolvedValue(0),
  zcard: vi.fn().mockResolvedValue(0),
  expire: vi.fn().mockResolvedValue(1),
}));
vi.mock('ioredis', () => ({ default: vi.fn(function() { return mockRedis; }), Redis: vi.fn(function() { return mockRedis; }) }));

const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));

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

vi.mock('../../audit/repository.js', () => ({
  auditRepository: { insert: vi.fn().mockResolvedValue({ id: 1 }) },
}));

describe('enabledFor', () => {
  let ff: typeof import('../../services/featureFlags.js');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
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

  it('returns true from account-level DB flag', async () => {
    mockQuery.mockResolvedValue({ rows: [{ enabled: true, percentage_rollout: 0 }] });
    const result = await ff.enabledFor('test_flag', 42);
    expect(result).toBe(true);
  });

  it('returns false from account-level DB flag', async () => {
    mockQuery.mockResolvedValue({ rows: [{ enabled: false, percentage_rollout: 0 }] });
    const result = await ff.enabledFor('test_flag', 42);
    expect(result).toBe(false);
  });

  it('uses percentage rollout when set on global flag', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true, percentage_rollout: 100 }] });
    const result = await ff.enabledFor('rollout_flag', 42);
    expect(result).toBe(true);
  });

  it('returns false when hash exceeds percentage', async () => {
    const results = new Set<boolean>();
    for (let i = 1; i <= 50; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false, percentage_rollout: 50 }] });
      results.add(await ff.enabledFor('rollout_flag', i));
    }
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });
});
