/**
 * Unit tests for src/health/index.ts — Health barrel export.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../health/queueHealth.js', () => ({ getQueueHealth: vi.fn(), hasCriticalQueues: vi.fn(), getDLQSummary: vi.fn(), closeHealthRedis: vi.fn() }));
vi.mock('../../health/scheduled.js', () => ({ startScheduledTasks: vi.fn(), stopScheduledTasks: vi.fn() }));
vi.mock('../../bridge/metrics.js', () => ({ bridgeMetrics: { setGauge: vi.fn() } }));
vi.mock('../../health/opencodeHealth.js', () => ({
  opencodeHealth: {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({
      status: 'unknown',
      reachable: false,
      httpStatus: 0,
      details: null,
      cachedAt: new Date().toISOString(),
      circuit: 'closed',
      consecutiveFailures: 0,
      modelInfo: null,
      queueDepth: null,
      activeSessions: null,
    })),
    isHealthy: vi.fn(() => false),
    isReachable: vi.fn(() => false),
    checkNow: vi.fn(),
  },
}));

describe('health/index', () => {
  it('exports queue health functions', async () => {
    const mod = await import('../../health/index.js');
    expect(mod.getQueueHealth).toBeDefined();
    expect(mod.hasCriticalQueues).toBeDefined();
    expect(mod.getDLQSummary).toBeDefined();
    expect(mod.closeHealthRedis).toBeDefined();
  });

  it('exports scheduled task functions', async () => {
    const mod = await import('../../health/index.js');
    expect(mod.startScheduledTasks).toBeDefined();
    expect(mod.stopScheduledTasks).toBeDefined();
  });

  it('exports opencode health singleton', async () => {
    const mod = await import('../../health/index.js');
    expect(mod.opencodeHealth).toBeDefined();
    expect(mod.opencodeHealth.start).toBeDefined();
    expect(mod.opencodeHealth.stop).toBeDefined();
    expect(mod.opencodeHealth.getStatus).toBeDefined();
    expect(mod.opencodeHealth.isHealthy).toBeDefined();
    expect(mod.opencodeHealth.isReachable).toBeDefined();
    expect(mod.opencodeHealth.checkNow).toBeDefined();
  });
});
