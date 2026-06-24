import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    queue: { redisUrl: 'redis://localhost:6379' },
    monitoring: { queueDepthWarnThreshold: 50, queueDepthCritThreshold: 200, dlqRetentionDays: 7, queueDepthAlertMinutes: 5 },
    rabbitmq: { url: 'amqp://guest:guest@localhost:5672/stas' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const mockRedis = vi.hoisted(() => ({
  llen: vi.fn().mockResolvedValue(0),
  zcount: vi.fn().mockResolvedValue(0),
  on: vi.fn().mockReturnThis(),
  quit: vi.fn().mockResolvedValue(undefined),
  connect: vi.fn().mockResolvedValue(undefined),
  status: 'close',
}));

vi.mock('ioredis', () => ({
  default: vi.fn(function() { return mockRedis; }),
  Redis: vi.fn(function() { return mockRedis; }),
}));

vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: { setGauge: vi.fn(), incrementCounter: vi.fn() },
  recordConsumerLag: vi.fn(),
}));

describe('health/queueHealth', () => {
  let qh: typeof import('../../health/queueHealth.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedis.llen.mockResolvedValue(0);
    mockRedis.zcount.mockResolvedValue(0);
    qh = await import('../../health/queueHealth.js');
  });

  describe('getQueueHealth', () => {
    it('returns a healthy report when queues are empty', async () => {
      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
      expect(report.summary.totalMessages).toBe(0);
      expect(report.timestamp).toBeDefined();
    });

    it('returns degraded when a main queue exceeds warn threshold', async () => {
      mockRedis.llen
        .mockResolvedValueOnce(60)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockRedis.zcount.mockResolvedValue(0);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('degraded');
      expect(report.summary.queuesWithWarnings).toBeGreaterThan(0);
    });

    it('returns critical when a queue exceeds crit threshold', async () => {
      mockRedis.llen
        .mockResolvedValueOnce(250)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockRedis.zcount.mockResolvedValue(0);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('critical');
      expect(report.summary.queuesWithCritical).toBeGreaterThan(0);
    });
  });

  describe('hasCriticalQueues', () => {
    it('returns empty arrays when healthy', async () => {
      const result = await qh.hasCriticalQueues();
      expect(result.critical).toEqual([]);
      expect(result.warning).toEqual([]);
    });
  });

  describe('closeHealthRedis', () => {
    it('is a no-op after BullMQ removal', async () => {
      await expect(qh.closeHealthRedis()).resolves.toBeUndefined();
    });
  });
});
