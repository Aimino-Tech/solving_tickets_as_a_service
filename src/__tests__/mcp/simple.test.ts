import { describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({ Redis: vi.fn() }));
vi.mock('../../trackers/index.js', () => ({ getTracker: vi.fn() }));
vi.mock('../../config.js', () => ({
  config: { slack: {}, queue: { redisUrl: '' }, trackers: {} },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../monitoring/sentry.js', () => ({ captureError: vi.fn() }));

describe('simple', () => {
  it('imports', async () => {
    console.log('before import');
    const mod = await import('../../mcp/agentServer.js');
    console.log('after import');
    expect(mod.default).toBeDefined();
  });
});
