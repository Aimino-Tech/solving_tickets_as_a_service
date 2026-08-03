import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const LUA_SHA = 'rate-limit-sha';

const mockRedis = {
  evalsha: vi.fn().mockResolvedValue([1, 9, 60000]),
  script: vi.fn().mockResolvedValue(LUA_SHA),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  status: 'close' as string | undefined,
};

vi.mock('ioredis', () => ({
  Redis: vi.fn(function () {
    return mockRedis;
  }),
}));

describe('TokenBucketRateLimiter', () => {
  let TokenBucketRateLimiter: typeof import('../../mitigations/rateLimiter.js').TokenBucketRateLimiter;
  let limiter: import('../../mitigations/rateLimiter.js').TokenBucketRateLimiter;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../mitigations/rateLimiter.js');
    TokenBucketRateLimiter = mod.TokenBucketRateLimiter;
    limiter = new TokenBucketRateLimiter('redis://localhost:6379');
  });

  it('loads the Lua script on first check', async () => {
    mockRedis.evalsha.mockResolvedValue([1, 9, 60000]);
    const result = await limiter.check('test-key', 10, 60000);
    expect(mockRedis.script).toHaveBeenCalledWith('LOAD', expect.any(String));
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.resetMs).toBe(60000);
  });

  it('returns allowed=false when rate limit exceeded', async () => {
    mockRedis.evalsha.mockResolvedValue([0, 0, 30000]);
    const result = await limiter.check('test-key', 10, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetMs).toBe(30000);
  });

  it('returns allowed=true when under limit', async () => {
    mockRedis.evalsha.mockResolvedValue([1, 5, 45000]);
    const result = await limiter.check('test-key', 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });

  it('handles Redis errors gracefully (fail-open)', async () => {
    mockRedis.evalsha.mockRejectedValue(new Error('Redis down'));
    const result = await limiter.check('test-key', 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('reuses the cached Lua SHA', async () => {
    mockRedis.evalsha.mockResolvedValue([1, 9, 60000]);
    await limiter.check('key-a', 10, 60000);
    await limiter.check('key-b', 10, 60000);
    expect(mockRedis.script).toHaveBeenCalledTimes(1);
  });

  it('uses correct Redis key prefix', async () => {
    await limiter.check('github:user-1', 5, 30000);
    expect(mockRedis.evalsha).toHaveBeenCalledWith(
      LUA_SHA, 1, 'syntaro:ratelimit:github:user-1', '5', '30000', expect.any(String),
    );
  });

  it('close quits Redis connection', async () => {
    await limiter.close();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
