import { afterEach, describe, expect, it, vi } from 'vitest';
import { meteringEvents } from '../../metering/events.js';
import {
  getUsageStore,
  resetCostConfig,
  UsageTracker,
  withUsageTracking,
} from '../../metering/index.js';

vi.mock('../../config.js', () => ({
  config: {
    metering: {
      costTriage: 1,
      costOpencodePrimary: 10,
      costOpencodeFallback: 5,
      costPrCreation: 2,
      costRetryPenalty: 3,
      baselineSandboxMs: 300000,
      freeMonthlyCredits: 100,
      sandboxMultiplierMin: 0.5,
      sandboxMultiplierMax: 2.0,
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

afterEach(() => {
  resetCostConfig();
});

describe('UsageTracker', () => {
  it('records a complete pipeline run', () => {
    const tracker = new UsageTracker({ source: 'github', runId: 'test-1' });
    tracker.start();
    tracker.recordTriage('gpt-4o-mini');
    tracker.recordAgentRun({ phase: 'primary', model: 'claude-sonnet-4', durationMs: 120_000 });
    tracker.recordSandboxTime(300_000);
    tracker.recordPRCreated();
    const record = tracker.stop();

    expect(record.runId).toBe('test-1');
    expect(record.source).toBe('github');
    expect(record.totalCredits).toBeGreaterThan(0);
    expect(record.phases).toHaveLength(4);
    expect(record.modelsUsed).toContain('claude-sonnet-4');
    expect(record.prCreated).toBe(true);
    expect(record.fallbackUsed).toBe(false);
  });

  it('tracks fallback usage', () => {
    const tracker = new UsageTracker({ source: 'linear' });
    tracker.start();
    tracker.recordAgentRun({ phase: 'primary', model: 'claude-sonnet-4' });
    tracker.recordFallback({ phase: 'fallback', model: 'gpt-4o' });
    const record = tracker.stop();

    expect(record.fallbackUsed).toBe(true);
    expect(record.modelsUsed).toContain('gpt-4o');
  });

  it('tracks retries', () => {
    const tracker = new UsageTracker({ source: 'github' });
    tracker.start();
    tracker.recordAgentRun({ phase: 'primary', model: 'claude-sonnet-4' });
    tracker.recordAgentRun({ phase: 'primary', model: 'claude-sonnet-4', isRetry: true });
    const record = tracker.stop();

    expect(record.retryCount).toBe(1);
  });

  it('stores usage records in the store', () => {
    const before = getUsageStore().length;
    const tracker = new UsageTracker({ source: 'github', installationId: 42, repo: 'owner/repo' });
    tracker.start();
    tracker.recordTriage();
    tracker.stop();

    const store = getUsageStore();
    expect(store.length).toBe(before + 1);
    expect(store[store.length - 1].installationId).toBe(42);
  });

  it('emits usage.recorded event', () => {
    const handler = vi.fn();
    meteringEvents.on('usage.recorded', handler);

    const tracker = new UsageTracker({ source: 'github', runId: 'event-test' });
    tracker.start();
    tracker.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].runId).toBe('event-test');

    meteringEvents.off('usage.recorded', handler);
  });

  it('getElapsedMs returns duration', () => {
    const tracker = new UsageTracker({ source: 'github' });
    tracker.start();
    tracker.stop();
    expect(tracker.getElapsedMs()).toBeGreaterThanOrEqual(0);
  });

  it('isRunning reflects state', () => {
    const tracker = new UsageTracker({ source: 'github' });
    expect(tracker.isRunning).toBe(false);
    tracker.start();
    expect(tracker.isRunning).toBe(true);
    tracker.stop();
    expect(tracker.isRunning).toBe(false);
  });
});

describe('withUsageTracking', () => {
  it('wraps an async function and returns usage', async () => {
    const { result, usage } = await withUsageTracking(
      { source: 'github', runId: 'wrapper-test' },
      async (tracker) => {
        tracker.recordTriage();
        tracker.recordAgentRun({ phase: 'primary', model: 'claude-sonnet-4' });
        return 'success';
      },
    );

    expect(result).toBe('success');
    expect(usage.runId).toBe('wrapper-test');
    expect(usage.totalCredits).toBeGreaterThan(0);
  });

  it('records usage even on error', async () => {
    const handler = vi.fn();
    meteringEvents.on('usage.recorded', handler);

    await expect(
      withUsageTracking(
        { source: 'github' },
        async () => {
          throw new Error('pipeline failed');
        },
      ),
    ).rejects.toThrow('pipeline failed');

    expect(handler).toHaveBeenCalledTimes(1);

    meteringEvents.off('usage.recorded', handler);
  });
});
