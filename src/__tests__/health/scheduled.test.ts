/**
 * Unit tests for src/health/scheduled.ts — Scheduled maintenance tasks.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetQueueHealth = vi.fn();
const mockHasCriticalQueues = vi.fn();
const mockGetDLQSummary = vi.fn();

vi.mock('../../health/queueHealth.js', () => ({
  getQueueHealth: mockGetQueueHealth,
  hasCriticalQueues: mockHasCriticalQueues,
  getDLQSummary: mockGetDLQSummary,
}));

vi.mock('../../config.js', () => ({
  config: {
    monitoring: { queueDepthAlertMinutes: 5, dlqRetentionDays: 7, queueDepthWarnThreshold: 50, queueDepthCritThreshold: 200 },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('health/scheduled', () => {
  let scheduled: typeof import('../../health/scheduled.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    scheduled = await import('../../health/scheduled.js');
  });

  describe('startScheduledTasks', () => {
    it('starts all scheduled timers', () => {
      vi.useFakeTimers();
      scheduled.startScheduledTasks();
      const timers = vi.getTimerCount();
      expect(timers).toBeGreaterThan(0);
      vi.useRealTimers();
      scheduled.stopScheduledTasks();
    }, 10000);
  });

  describe('stopScheduledTasks', () => {
    it('stops all scheduled timers', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      scheduled.startScheduledTasks();
      scheduled.stopScheduledTasks();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
