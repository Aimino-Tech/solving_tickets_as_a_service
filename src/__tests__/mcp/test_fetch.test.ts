import { describe, expect, it, vi } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

vi.mock('ioredis', () => ({ Redis: vi.fn() }));
vi.mock('../../trackers/index.js', () => ({ getTracker: vi.fn() }));
vi.mock('../../config.js', () => ({
  config: { slack: { botToken: 'xoxb-test-token' }, queue: { redisUrl: '' }, trackers: {} },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../monitoring/sentry.js', () => ({ captureError: vi.fn() }));

describe('test_fetch', () => {
  it('calls tools/list', async () => {
    const mod = await import('../../mcp/agentServer.js');
    const router = mod.default;
    const data = await new Promise((resolve) => {
      const json = vi.fn().mockImplementation((data: unknown) => { resolve(data); });
      const req = { body: { jsonrpc: '2.0', method: 'tools/list', id: 1 } } as any;
      const res = { json } as any;
      router(req, res, () => {});
    });
    expect(data).toBeDefined();
  });
});
