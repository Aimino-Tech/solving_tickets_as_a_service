import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockRedis = {
  setex: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  lrange: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('ioredis', () => ({ Redis: vi.fn(() => mockRedis) }));

let mockTracker: { createTicket: ReturnType<typeof vi.fn> };

vi.mock('../../trackers/index.js', () => ({
  getTracker: vi.fn(() => mockTracker),
}));

vi.mock('../../config.js', () => ({
  config: {
    slack: { botToken: 'xoxb-test-token' },
    queue: { redisUrl: 'redis://localhost:6379' },
    trackers: {},
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../monitoring/sentry.js', () => ({
  captureError: vi.fn(),
}));

describe('mcp/agentServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = { createTicket: vi.fn() };
  });

  it('exports a default router', async () => {
    const mod = await import('../../mcp/agentServer.js');
    expect(mod.default).toBeDefined();
  });

  it('module loads without errors', async () => {
    await expect(import('../../mcp/agentServer.js')).resolves.toBeDefined();
  });
});
