import { describe, expect, it, vi } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  setex: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null),
  lrange: vi.fn().mockResolvedValue([]), rpush: vi.fn().mockResolvedValue(1),
  del: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1), on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({ Redis: vi.fn(() => mockRedis) }));
vi.stubGlobal('fetch', mockFetch);
vi.mock('../../trackers/index.js', () => ({ getTracker: vi.fn() }));
vi.mock('../../config.js', () => ({
  config: { slack: { botToken: 'xoxb-test-token' }, queue: { redisUrl: 'redis://localhost:6379' }, trackers: {} },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../monitoring/sentry.js', () => ({ captureError: vi.fn() }));

async function dispatch(body: unknown): Promise<unknown> {
  const mod = await import('../../mcp/agentServer.js');
  const router = mod.default;
  return new Promise((resolve) => {
    const json = vi.fn().mockImplementation((data: unknown) => { resolve(data); });
    const req = { body } as any;
    const res = { json } as any;
    router(req, res, () => {});
  });
}

describe('compare', () => {
  it('calls tools/list', async () => {
    const data = await dispatch({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(data).toBeDefined();
  });
});
