/**
 * Unit tests for src/health/queueHealth.ts — Queue health monitoring (RabbitMQ).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    queue: { rabbitmqUrl: 'amqp://localhost:5672/stas' },
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

vi.mock('../../queue/rabbitmq.js', () => ({
  getChannel: vi.fn().mockReturnValue({
    checkQueue: vi.fn().mockResolvedValue({ messageCount: 0, consumerCount: 0 }),
  }),
  isConnected: vi.fn().mockReturnValue(true),
  connect: vi.fn().mockResolvedValue(undefined),
}));

describe('queueHealth (RabbitMQ)', () => {
  it('returns healthy when queues are empty', async () => {
    const { getQueueHealth } = await import('../../health/queueHealth.js');
    const report = await getQueueHealth();
    expect(report.status).toBe('healthy');
    expect(report.queues.length).toBeGreaterThanOrEqual(2);
  });

  it('returns degraded when main queue is over warn threshold', async () => {
    const rabbitmq = await import('../../queue/rabbitmq.js');
    (rabbitmq.getChannel as ReturnType<typeof vi.fn>).mockReturnValue({
      checkQueue: vi.fn().mockResolvedValue({ messageCount: 100, consumerCount: 0 }),
    });

    const { getQueueHealth } = await import('../../health/queueHealth.js');
    const report = await getQueueHealth();
    expect(['degraded', 'critical']).toContain(report.status);
  });


});
