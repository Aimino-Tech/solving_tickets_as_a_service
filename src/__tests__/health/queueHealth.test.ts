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

describe('health/queueHealth', () => {
  let qh: typeof import('../../health/queueHealth.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    qh = await import('../../health/queueHealth.js');
  });

  describe('getQueueHealth', () => {
    it('returns a healthy report when RabbitMQ is disconnected', async () => {
      mockIsConnected.mockReturnValue(false);

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
      expect(report.summary.totalMessages).toBe(0);
      expect(report.rabbitmq.connected).toBe(false);
      expect(report.timestamp).toBeDefined();
    });

    it('returns healthy when connected and queues are empty', async () => {
      mockIsConnected.mockReturnValue(true);
      // Mock fetch to return empty queues
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

      const report = await qh.getQueueHealth();
      expect(report.status).toBe('healthy');
      expect(report.rabbitmq.connected).toBe(true);
    });

    it('returns degraded when a main queue exceeds warn threshold', async () => {
      mockIsConnected.mockReturnValue(true);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { name: 'stas.issues.fix', messages: 60, messages_ready: 60, messages_unacknowledged: 0, consumers: 0 },
        ]),
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
