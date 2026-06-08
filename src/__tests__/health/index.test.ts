/**
 * Unit tests for src/health/index.ts — Health barrel export.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../health/queueHealth.js', () => ({ getQueueHealth: vi.fn(), hasCriticalQueues: vi.fn(), getDLQSummary: vi.fn(), closeHealthRedis: vi.fn() }));
vi.mock('../../health/scheduled.js', () => ({ startScheduledTasks: vi.fn(), stopScheduledTasks: vi.fn() }));
vi.mock('../../bridge/metrics.js', () => ({ bridgeMetrics: { setGauge: vi.fn() } }));

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
});
