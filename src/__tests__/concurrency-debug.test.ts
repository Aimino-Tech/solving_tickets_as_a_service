import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
  },
}));

vi.mock('../ratelimit/tiers.js', () => ({
  getConcurrencyLimitForAccount: (id: number) => {
    if (id === 1) return 1;
    if (id === 2) return 3;
    if (id === 3) return 10;
    return 1;
  },
}));

const { ConcurrencyManager } = await import('../ratelimit/concurrency.js');

describe('ConcurrencyManager debug', () => {
  let manager: InstanceType<typeof ConcurrencyManager>;

  beforeEach(() => {
    mockRedisConstructor.default.mockImplementation(() => mockRedisClient);
    manager = new ConcurrencyManager({ timeoutSeconds: 600 });
    mockRedisClient.sadd.mockResolvedValue(1);
    mockRedisClient.scard.mockResolvedValue(1);
    mockRedisClient.srem.mockResolvedValue(1);
    mockRedisClient.expire.mockResolvedValue(1);
    mockRedisClient.hget.mockResolvedValue(null);
  });

  it('debug acquire', async () => {
    try {
      const client = (manager as any).getClient();
      console.log('CLIENT:', client === mockRedisClient ? 'same' : typeof client);
      const result = await manager.acquire(2, 'run-123');
      console.log('RESULT:', JSON.stringify(result));
      console.log('scard calls:', mockRedisClient.scard.mock.calls.length);
    } catch (e: any) {
      console.log('ERROR:', e.message, e.stack?.split('\n').slice(0,5).join('\n'));
    }
  });
});
