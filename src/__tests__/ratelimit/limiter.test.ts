/**
 * Unit tests for src/ratelimit/limiter.ts — Redis-backed sliding window rate limiter.
 *
 * Strategy:
 *   Mock the ioredis Redis client and test the RateLimiter logic in isolation.
 *   The sliding window algorithm (ZADD, ZREMRANGEBYSCORE, ZCOUNT) is the core
 *   concern — we verify correct behavior by simulating Redis pipeline responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../../ratelimit/limiter.js';
// ── Mocks ──────────────────────────────────────────────────────────────────
const mockPipeline = vi.hoisted(() => ({
  zadd: vi.fn().mockReturnThis(),
  zremrangebyscore: vi.fn().mockReturnThis(),
  zcount: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn(),
}));

const mockRedisClient = vi.hoisted(() => ({
  pipeline: vi.fn().mockReturnValue(mockPipeline),
  zrange: vi.fn(),
  zscore: vi.fn(),
  zremrangebyscore: vi.fn(),
  zcount: vi.fn(),
  zadd: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  on: vi.fn().mockReturnThis(),
  quit: vi.fn().mockResolvedValue(undefined),
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
    stas: {
      rateLimit: { windowMs: 60_000, max: 30 },
    },
  },
}));
vi.mock('ioredis', () => ({
  Redis: vi.fn(() => mockRedisClient),
}));
// ── Suite ──────────────────────────────────────────────────────────────────
describe('RateLimiter', () => {
  let limiter: RateLimiter;
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.pipeline.mockReturnValue(mockPipeline);
    limiter = new RateLimiter({ windowMs: 60_000, max: 10 });
    // Default pipeline exec returns empty results
    mockPipeline.exec.mockResolvedValue([
      [null, 3],  // zremrangebyscore result
      [null, 5],  // zcount result
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  // ── checkLimit ──────────────────────────────────────────────────────────
  describe('checkLimit', () => {
    it('returns allowed=true when count is below max', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 2],  // zremrangebyscore: removed 2 old entries
        [null, 5],  // zcount: 5 entries remain
      ]);
      mockRedisClient.zrange.mockResolvedValue([]);
      const result = await limiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(5);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(5);
      expect(result.scope).toBe('account');
    });
    it('returns allowed=false when count is at or above max', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 10],  // exactly at limit
      ]);
      mockRedisClient.zrange.mockResolvedValue([]);
      const result = await limiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(0);
    });
    it('returns allowed=false when count exceeds max', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 15],  // exceeds limit
      ]);
      mockRedisClient.zrange.mockResolvedValue([]);
      const result = await limiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(15);
      expect(result.remaining).toBe(0);
    });
    it('calculates reset time based on oldest entry', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30_000; // 30 seconds ago
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 3],
      ]);
      mockRedisClient.zrange.mockResolvedValue(['1700000000000:abc']);
      mockRedisClient.zscore.mockResolvedValue(String(oldestTimestamp));
      const result = await limiter.checkLimit('account', '12345');
      // Reset should be oldestTimestamp + windowMs
      expect(result.reset).toBe(oldestTimestamp + 60_000);
      expect(result.windowMs).toBe(60_000);
    });
    it('returns fail-open result on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis connection refused'));
      const result = await limiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(true);  // fail-open
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(1);
    });
    it('uses correct Redis key format', async () => {
      await limiter.checkLimit('account', '999');
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        'ratelimit:account:999',
        expect.any(Number),
        expect.any(Number),
      );
      await limiter.checkLimit('repo', 'owner/repo');
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        'ratelimit:repo:owner/repo',
        expect.any(Number),
        expect.any(Number),
      );
      await limiter.checkLimit('ip', '192.168.1.1');
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        'ratelimit:ip:192.168.1.1',
        expect.any(Number),
        expect.any(Number),
      );
    });
    it('cleans old entries before counting', async () => {
      const now = Date.now();
      const windowStart = now - 60_000;
      // Mock Date.now to return a fixed value
      vi.spyOn(Date, 'now').mockReturnValue(now);
      await limiter.checkLimit('account', '12345');
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        'ratelimit:account:12345',
        0,
        windowStart,
      );
      expect(mockPipeline.zcount).toHaveBeenCalledWith(
        'ratelimit:account:12345',
        windowStart,
        now,
      );
    });
  });
  // ── increment ──────────────────────────────────────────────────────────
  describe('increment', () => {
    it('adds entry and returns updated count', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 1],  // zadd
        [null, 0],  // zremrangebyscore
        [null, 6],  // zcount
        [null, 1],  // expire
      ]);
      const result = await limiter.increment('account', '12345');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(6);
      expect(result.remaining).toBe(4);
      expect(mockPipeline.zadd).toHaveBeenCalled();
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        'ratelimit:account:12345',
        61,  // ceil(60000/1000) + 1
      );
    });
    it('returns not allowed when increment exceeds limit', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 1],
        [null, 0],
        [null, 10],  // at limit
        [null, 1],
      ]);
      const result = await limiter.increment('account', '12345');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(0);
    });
    it('returns fail-open on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Timeout'));
      const result = await limiter.increment('account', '12345');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });
  });
  // ── reset ──────────────────────────────────────────────────────────────
  describe('reset', () => {
    it('deletes the Redis key', async () => {
      mockRedisClient.del.mockResolvedValue(1);
      await limiter.reset('account', '12345');
      expect(mockRedisClient.del).toHaveBeenCalledWith('ratelimit:account:12345');
    });
    it('does not throw on Redis error', async () => {
      mockRedisClient.del.mockRejectedValue(new Error('Connection lost'));
      await expect(limiter.reset('account', '12345')).resolves.not.toThrow();
    });
  });
  // ── getCurrentCount ────────────────────────────────────────────────────
  describe('getCurrentCount', () => {
    it('returns current count from Redis', async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 7],
      ]);
      const count = await limiter.getCurrentCount('account', '12345');
      expect(count).toBe(7);
    });
    it('returns 0 on Redis failure', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Error'));
      const count = await limiter.getCurrentCount('account', '12345');
      expect(count).toBe(0);
    });
  });
  // ── Edge cases ─────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty pipeline results gracefully', async () => {
      mockPipeline.exec.mockResolvedValue(null);
      const result = await limiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });
    it('handles zero max (effectively blocks all)', async () => {
      const zeroLimiter = new RateLimiter({ windowMs: 60_000, max: 0 });
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 1],  // one request already counted
      ]);
      mockRedisClient.zrange.mockResolvedValue([]);
      const result = await zeroLimiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
    it('handles extremely large window sizes', async () => {
      const largeWindowLimiter = new RateLimiter({ windowMs: 86_400_000, max: 1000 });  // 24h
      mockPipeline.exec.mockResolvedValue([
        [null, 0],
        [null, 500],
      ]);
      mockRedisClient.zrange.mockResolvedValue([]);
      const result = await largeWindowLimiter.checkLimit('account', '12345');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(500);
      expect(result.windowMs).toBe(86_400_000);
    });
  });
});
