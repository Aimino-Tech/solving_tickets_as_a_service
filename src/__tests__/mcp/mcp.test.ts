import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedis = {
  setex: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  lrange: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => ({ Redis: vi.fn(() => mockRedis) }));

vi.mock('../../config.js', () => ({
  config: {
    mcp: { apiKey: 'test-key', authEnabled: true },
    queue: { redisUrl: 'redis://localhost:6379' },
    trackers: { defaultRepoOwner: 'testowner', defaultRepoName: 'testrepo' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('routes/mcp', () => {
  beforeEach(async () => { vi.clearAllMocks(); });

  it('exports a default router', async () => {
    const router = await import('../../routes/mcp.js');
    expect(router.default).toBeDefined();
  });
});
