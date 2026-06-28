/**
 * Unit tests for src/health/queueHealth.ts — Queue health monitoring (BullMQ).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
    monitoring: { queueDepthWarnThreshold: 50, queueDepthCritThreshold: 200, dlqRetentionDays: 7, queueDepthAlertMinutes: 5 },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: { setGauge: vi.fn(), incrementCounter: vi.fn() },
  recordConsumerLag: vi.fn(),
}));

const mockRedisForHealth = {
  llen: vi.fn().mockResolvedValue(0),
  zcount: vi.fn().mockResolvedValue(0),
  zadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  status: 'close',
};
vi.mock('ioredis', () => ({
  Redis: vi.fn(function() { return mockRedisForHealth; }),
}));

describe('health/queueHealth', () => {
  let qh: typeof import('../../health/queueHealth.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    qh = await import('../../health/queueHealth.js');
  });

  describe('getQueueHealth', () => {
    it('returns a healthy report when queues are empty', async () => {
      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
      expect(report.summary.totalMessages).toBe(0);
      expect(report.queues).toBeDefined();
      expect(report.queues.length).toBeGreaterThanOrEqual(0);
      expect(report.timestamp).toBeDefined();
    });

    it('returns degraded when a main queue exceeds warn threshold', async () => {
      mockRedisForHealth.llen.mockReset();
      mockRedisForHealth.llen.mockResolvedValue(60);
      const firstCall = await mockRedisForHealth.llen('test');
      expect(firstCall).toBe(60);

      mockRedisForHealth.llen.mockReset();
      mockRedisForHealth.llen.mockImplementation(function(key: string) {
        if (key && key.startsWith('bull:stas-issues:') && !key.startsWith('bull:stas-issues-dlq:')) {
          return Promise.resolve(60);
        }
        return Promise.resolve(0);
      });
      mockRedisForHealth.zcount.mockReset();
      mockRedisForHealth.zcount.mockResolvedValue(0);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('degraded');
      expect(report.summary.queuesWithWarnings).toBeGreaterThan(0);
    });
  });

  describe('hasCriticalQueues', () => {
    it('returns empty arrays when healthy', async () => {
      // Reset llen to return 0 (previous test may have set it to 60)
      mockRedisForHealth.llen.mockReset();
      mockRedisForHealth.llen.mockResolvedValue(0);
      mockRedisForHealth.zcount.mockReset();
      mockRedisForHealth.zcount.mockResolvedValue(0);

      const result = await qh.hasCriticalQueues();
      expect(result.critical).toEqual([]);
      expect(result.warning).toEqual([]);
    });
  });

  describe('closeHealthRedis', () => {
    it('is a no-op after BullMQ removal', async () => {
      // Should not throw
      await expect(qh.closeHealthRedis()).resolves.toBeUndefined();
    });
  });
});
