/**
 * Unit tests for src/health/queueHealth.ts — Queue health monitoring (RabbitMQ).
 */
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

// Mock RabbitMQ connection — disconnected by default
const mockIsConnected = vi.fn(() => false);
vi.mock('../../queue/rabbitmq.js', () => ({
  isConnected: mockIsConnected,
  QUEUES: {
    issuesFix: { name: 'stas.issues.fix', exchange: 'stas.issues', routingKey: 'fix' },
    triage: { name: 'stas.agents.triage', exchange: 'stas.agents', routingKey: 'triage' },
  },
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
  default: vi.fn(function() { return mockRedisForHealth; }),
  Redis: vi.fn(function() { return mockRedisForHealth; }),
}));

describe.skip('health/queueHealth', () => {
  let qh: typeof import('../../health/queueHealth.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedisForHealth.llen = vi.fn().mockResolvedValue(0);
    mockRedisForHealth.zcount = vi.fn().mockResolvedValue(0);
    qh = await import('../../health/queueHealth.js');
  });

  describe('getQueueHealth', () => {
    it('returns a healthy report when queue depth is zero', async () => {
      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
      expect(report.summary.totalMessages).toBe(0);
      expect(report.timestamp).toBeDefined();
    });

    it('returns healthy when connected and queues are empty', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
    });

    it('returns degraded when a main queue exceeds warn threshold', async () => {
      const { closeHealthRedis } = await import('../../health/queueHealth.js');
      await closeHealthRedis();

      mockRedisForHealth.llen = vi.fn().mockImplementation((key: string) => {
        if (key.includes('stas-issues:wait')) return Promise.resolve(60);
        return Promise.resolve(0);
      });

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('degraded');
      expect(report.summary.queuesWithWarnings).toBeGreaterThan(0);
    });
  });

  describe('hasCriticalQueues', () => {
    it('returns empty arrays when healthy', async () => {
      mockIsConnected.mockReturnValue(false);

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
