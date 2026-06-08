/**
 * Unit tests for src/health/queueHealth.ts — Queue health monitoring.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedis = {
  llen: vi.fn(), zcount: vi.fn(), connect: vi.fn(), quit: vi.fn(), on: vi.fn(),
  status: 'wait',
};

vi.mock('ioredis', () => ({ default: vi.fn(() => mockRedis), Redis: vi.fn(() => mockRedis) }));

vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
    monitoring: { queueDepthWarnThreshold: 50, queueDepthCritThreshold: 200, dlqRetentionDays: 7, queueDepthAlertMinutes: 5 },
    rabbitmq: { url: '' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../queue/rabbitmq.js', () => ({ isConnected: vi.fn(() => false) }));

vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: { setGauge: vi.fn(), incrementCounter: vi.fn() },
  recordConsumerLag: vi.fn(),
}));

describe('health/queueHealth', () => {
  let qh: typeof import('../../health/queueHealth.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    qh = await import('../../health/queueHealth.js');
  });

  describe('getQueueHealth', () => {
    it('returns a healthy report when queues are empty', async () => {
      mockRedis.llen.mockResolvedValue(0);
      mockRedis.zcount.mockResolvedValue(0);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
      expect(report.summary.totalMessages).toBe(0);
      expect(report.timestamp).toBeDefined();
    });

    it('returns degraded when queue depth exceeds warn threshold', async () => {
      mockRedis.llen.mockImplementation((key: string) => {
        if (key.includes(':wait')) return Promise.resolve(60);
        return Promise.resolve(0);
      });
      mockRedis.zcount.mockResolvedValue(0);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('warn');
      expect(report.summary.queuesWithWarnings).toBeGreaterThan(0);
    });

    it('returns critical when queue depth exceeds crit threshold', async () => {
      mockRedis.llen.mockImplementation((key: string) => {
        if (key.includes(':wait')) return Promise.resolve(250);
        return Promise.resolve(0);
      });
      mockRedis.zcount.mockResolvedValue(0);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('critical');
    });
  });

  describe('hasCriticalQueues', () => {
    it('returns empty arrays when healthy', async () => {
      mockRedis.llen.mockResolvedValue(0);
      mockRedis.zcount.mockResolvedValue(0);

      const result = await qh.hasCriticalQueues();
      expect(result.critical).toEqual([]);
      expect(result.warning).toEqual([]);
    });
  });

  describe('getDLQSummary', () => {
    it('returns summary of DLQ entries', async () => {
      mockRedis.llen.mockImplementation((key: string) => {
        if (key.includes('dlq')) return Promise.resolve(5);
        return Promise.resolve(0);
      });
      mockRedis.zcount.mockResolvedValue(0);

      const summary = await qh.getDLQSummary();
      expect(summary.totalDlqMessages).toBeGreaterThan(0);
    });
  });

  describe('closeHealthRedis', () => {
    it('closes the Redis connection', async () => {
      mockRedis.quit.mockResolvedValue('OK');
      await qh.closeHealthRedis();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
