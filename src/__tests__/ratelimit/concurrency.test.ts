/**
 * Unit tests for src/ratelimit/concurrency.ts — Per-account concurrency manager.
 *
 * Strategy:
 *   Mock ioredis Redis client and test the ConcurrencyManager logic in isolation.
 *   Each test verifies acquire/release/override behavior with simulated Redis state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRedisClient = {
  sadd: vi.fn(),
  scard: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  sismember: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  hget: vi.fn(),
  on: vi.fn().mockReturnThis(),
  quit: vi.fn().mockResolvedValue(undefined),
};

const mockRedisConstructor = vi.hoisted(() => ({
  default: vi.fn().mockImplementation(() => mockRedisClient),
}));

vi.mock('ioredis', () => ({
  Redis: mockRedisConstructor.default,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
  },
}));

vi.mock('../../ratelimit/tiers.js', () => ({
  getConcurrencyLimitForAccount: vi.fn().mockImplementation((id: number) => {
    // Account 1 = Free (1), Account 2 = Pro (3), Account 3 = Enterprise (10)
    if (id === 1) return 1;
    if (id === 2) return 3;
    if (id === 3) return 10;
    return 1; // default free
  }),
}));

// Import after mocks are set up
const { ConcurrencyManager } = await import('../../ratelimit/concurrency.js');

// ── Suite ──────────────────────────────────────────────────────────────────

describe('ConcurrencyManager', () => {
  let manager: InstanceType<typeof ConcurrencyManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ConcurrencyManager({ timeoutSeconds: 600 });

    // Default: not at capacity
    mockRedisClient.sadd.mockResolvedValue(1);
    mockRedisClient.scard.mockResolvedValue(1);  // 1 active run
    mockRedisClient.srem.mockResolvedValue(1);
    mockRedisClient.expire.mockResolvedValue(1);
    mockRedisClient.hget.mockResolvedValue(null);  // no admin override
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── acquire ────────────────────────────────────────────────────────────

  describe('acquire', () => {
    it('acquires a slot when under concurrency limit', async () => {
      mockRedisClient.scard.mockResolvedValue(1);  // 1 of 3 used
      const result = await manager.acquire(2, 'run-123');

      expect(result.acquired).toBe(true);
      expect(result.activeCount).toBe(1);
      expect(result.limit).toBe(3);
      expect(result.position).toBe(1);
      expect(mockRedisClient.sadd).toHaveBeenCalledWith('concurrency:account:2', 'run-123');
      expect(mockRedisClient.expire).toHaveBeenCalledWith('concurrency:account:2', 600);
    });

    it('blocks when at concurrency limit', async () => {
      mockRedisClient.scard.mockResolvedValue(3);  // 3 of 3 used (at limit)
      const result = await manager.acquire(2, 'run-456');

      expect(result.acquired).toBe(false);
      expect(result.activeCount).toBe(2);  // srem removes our entry, so count goes to 2
      expect(result.limit).toBe(3);
      expect(result.position).toBe(4);  // queue position = limit + 1
      // Should have removed our entry since we're over limit
      expect(mockRedisClient.srem).toHaveBeenCalledWith('concurrency:account:2', 'run-456');
    });

    it('blocks when exceeding concurrency limit', async () => {
      mockRedisClient.scard.mockResolvedValue(5);  // 5 of 3 used (exceeded)
      const result = await manager.acquire(2, 'run-789');

      expect(result.acquired).toBe(false);
      expect(mockRedisClient.srem).toHaveBeenCalledWith('concurrency:account:2', 'run-789');
    });

    it('enforces free tier limit (1 concurrent run)', async () => {
      mockRedisClient.scard.mockResolvedValue(1);  // 1 of 1 used
      const result = await manager.acquire(1, 'run-free');

      expect(result.acquired).toBe(true);  // exactly at limit, first to add
      expect(result.limit).toBe(1);
    });

    it('enforces enterprise tier limit (10 concurrent runs)', async () => {
      mockRedisClient.scard.mockResolvedValue(10);  // at limit
      const result = await manager.acquire(3, 'run-enterprise');

      expect(result.acquired).toBe(false);
      expect(result.limit).toBe(10);
      expect(mockRedisClient.srem).toHaveBeenCalledWith('concurrency:account:3', 'run-enterprise');
    });

    it('returns fail-open on Redis error', async () => {
      mockRedisClient.sadd.mockRejectedValue(new Error('Redis down'));
      const result = await manager.acquire(1, 'run-error');

      expect(result.acquired).toBe(true);  // fail-open
      expect(result.activeCount).toBe(0);
      expect(result.limit).toBe(1);
      expect(result.position).toBe(1);
    });

    it('uses admin override limit when set', async () => {
      // Admin override: account 1 gets 5 concurrent runs
      mockRedisClient.hget.mockResolvedValue('5');
      mockRedisClient.scard.mockResolvedValue(3);  // 3 of 5 used
      const result = await manager.acquire(1, 'run-admin');

      expect(result.acquired).toBe(true);
      expect(result.activeCount).toBe(3);
      expect(result.limit).toBe(5);
      // Should NOT have called tiers for this account since override exists
    });
  });

  // ── release ────────────────────────────────────────────────────────────

  describe('release', () => {
    it('removes the run from the active set', async () => {
      mockRedisClient.scard.mockResolvedValue(2);  // still has entries
      await manager.release(2, 'run-123');

      expect(mockRedisClient.srem).toHaveBeenCalledWith('concurrency:account:2', 'run-123');
      expect(mockRedisClient.del).not.toHaveBeenCalled();  // not empty yet
    });

    it('deletes the key when set becomes empty', async () => {
      mockRedisClient.scard.mockResolvedValue(0);  // no more entries
      await manager.release(2, 'run-last');

      expect(mockRedisClient.srem).toHaveBeenCalledWith('concurrency:account:2', 'run-last');
      expect(mockRedisClient.del).toHaveBeenCalledWith('concurrency:account:2');
    });

    it('does not throw on Redis error', async () => {
      mockRedisClient.srem.mockRejectedValue(new Error('Redis error'));
      await expect(manager.release(2, 'run-error')).resolves.not.toThrow();
    });
  });

  // ── getActiveCount ─────────────────────────────────────────────────────

  describe('getActiveCount', () => {
    it('returns the current active run count', async () => {
      mockRedisClient.scard.mockResolvedValue(3);
      const count = await manager.getActiveCount(1);
      expect(count).toBe(3);
    });

    it('returns 0 on Redis error', async () => {
      mockRedisClient.scard.mockRejectedValue(new Error('Error'));
      const count = await manager.getActiveCount(1);
      expect(count).toBe(0);
    });
  });

  // ── getActiveRuns ──────────────────────────────────────────────────────

  describe('getActiveRuns', () => {
    it('returns list of active run IDs', async () => {
      mockRedisClient.smembers.mockResolvedValue(['run-1', 'run-2']);
      const runs = await manager.getActiveRuns(1);
      expect(runs).toEqual(['run-1', 'run-2']);
    });

    it('returns empty array on Redis error', async () => {
      mockRedisClient.smembers.mockRejectedValue(new Error('Error'));
      const runs = await manager.getActiveRuns(1);
      expect(runs).toEqual([]);
    });
  });

  // ── isRunActive ────────────────────────────────────────────────────────

  describe('isRunActive', () => {
    it('returns true when run is active', async () => {
      mockRedisClient.sismember.mockResolvedValue(1);
      const active = await manager.isRunActive(1, 'run-123');
      expect(active).toBe(true);
    });

    it('returns false when run is not active', async () => {
      mockRedisClient.sismember.mockResolvedValue(0);
      const active = await manager.isRunActive(1, 'run-123');
      expect(active).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisClient.sismember.mockRejectedValue(new Error('Error'));
      const active = await manager.isRunActive(1, 'run-123');
      expect(active).toBe(false);
    });
  });

  // ── Admin overrides ────────────────────────────────────────────────────

  describe('admin overrides', () => {
    it('setAdminOverride stores the override in Redis', async () => {
      await manager.setAdminOverride(1, 10);
      expect(mockRedisClient.hset).toHaveBeenCalledWith('concurrency:overrides', '1', '10');
    });

    it('removeAdminOverride deletes the override from Redis', async () => {
      await manager.removeAdminOverride(1);
      expect(mockRedisClient.hdel).toHaveBeenCalledWith('concurrency:overrides', '1');
    });

    it('getEffectiveLimit returns admin override when set', async () => {
      mockRedisClient.hget.mockResolvedValue('20');
      const limit = await manager.getEffectiveLimit(1);
      expect(limit).toBe(20);
    });

    it('getEffectiveLimit returns tier limit when no override', async () => {
      mockRedisClient.hget.mockResolvedValue(null);  // no override
      const limit = await manager.getEffectiveLimit(1);
      expect(limit).toBe(1);  // free tier
    });

    it('getEffectiveLimit returns tier limit for account 2 (pro)', async () => {
      mockRedisClient.hget.mockResolvedValue(null);
      const limit = await manager.getEffectiveLimit(2);
      expect(limit).toBe(3);  // pro tier
    });
  });

  // ── cleanupStaleRuns ───────────────────────────────────────────────────

  describe('cleanupStaleRuns', () => {
    it('refreshes TTL and returns member count', async () => {
      mockRedisClient.smembers.mockResolvedValue(['run-1', 'run-2', 'run-3']);
      const count = await manager.cleanupStaleRuns(1);
      expect(count).toBe(3);
      expect(mockRedisClient.expire).toHaveBeenCalledWith('concurrency:account:1', 600);
    });

    it('does not set TTL for empty set', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);
      const count = await manager.cleanupStaleRuns(1);
      expect(count).toBe(0);
      expect(mockRedisClient.expire).not.toHaveBeenCalled();
    });

    it('returns 0 on Redis error', async () => {
      mockRedisClient.smembers.mockRejectedValue(new Error('Error'));
      const count = await manager.cleanupStaleRuns(1);
      expect(count).toBe(0);
    });
  });

  // ── close ──────────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes the Redis client', async () => {
      // Force client creation by calling acquire first
      mockRedisClient.scard.mockResolvedValue(0);
      await manager.acquire(1, 'run-close');
      await manager.close();
      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('handles close error gracefully', async () => {
      // Force client creation
      mockRedisClient.scard.mockResolvedValue(0);
      await manager.acquire(1, 'run-close');
      mockRedisClient.quit.mockRejectedValue(new Error('Close error'));
      await expect(manager.close()).resolves.not.toThrow();
    });
  });
});
