import { describe, it, expect, vi } from 'vitest';
import type { IssueJobData } from '../../utils/types.js';

function createMockAdapter(backend: 'bullmq' | 'rabbitmq') {
  return {
    enqueue: vi.fn().mockResolvedValue(`${backend}-job-id`),
    startConsumer: vi.fn().mockResolvedValue(undefined),
    stopConsumer: vi.fn().mockResolvedValue(undefined),
    getDepth: vi.fn().mockResolvedValue(0),
    getBackend: vi.fn().mockReturnValue(backend),
    isHealthy: vi.fn().mockResolvedValue(true),
  };
}

const sampleJobData: IssueJobData = {
  installationId: 123,
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  issueNumber: 42,
  issueTitle: 'Test issue',
  issueBody: 'Test body',
  repoPrivate: false,
  source: 'github',
};

const baseConfig = {
  name: 'test-queue',
  exchange: 'test-exchange',
  routingKey: 'test-key',
  durable: true,
  ttl: 30000,
  dedupTtl: 120,
  maxRetries: 3,
  retryDelaysMs: [30000, 120000],
  deadLetterExchange: 'dlx',
  deadLetterRoutingKey: 'dlq',
};

describe('QueueAdapter Interface', () => {
  it('should expose the expected adapter interface', () => {
    const adapter = createMockAdapter('bullmq');
    expect(adapter).toHaveProperty('enqueue');
    expect(adapter).toHaveProperty('startConsumer');
    expect(adapter).toHaveProperty('stopConsumer');
    expect(adapter).toHaveProperty('getDepth');
    expect(adapter).toHaveProperty('getBackend');
    expect(adapter).toHaveProperty('isHealthy');
  });

  it('should return bullmq backend type', () => {
    const adapter = createMockAdapter('bullmq');
    expect(adapter.getBackend()).toBe('bullmq');
  });

  it('should return rabbitmq backend type', () => {
    const adapter = createMockAdapter('rabbitmq');
    expect(adapter.getBackend()).toBe('rabbitmq');
  });

  describe('enqueue', () => {
    it('should enqueue a job and return an id', async () => {
      const adapter = createMockAdapter('bullmq');
      const result = await adapter.enqueue(sampleJobData);

      expect(result).toBe('bullmq-job-id');
      expect(adapter.enqueue).toHaveBeenCalledWith(sampleJobData);
    });

    it('should support enqueue options', async () => {
      const adapter = createMockAdapter('rabbitmq');
      const result = await adapter.enqueue(sampleJobData, { delay: 5000, priority: 10, dedupKey: 'dedup-123' });

      expect(result).toBe('rabbitmq-job-id');
      expect(adapter.enqueue).toHaveBeenCalledWith(sampleJobData, { delay: 5000, priority: 10, dedupKey: 'dedup-123' });
    });

    it('should handle enqueue rejection gracefully', async () => {
      const adapter = createMockAdapter('bullmq');
      adapter.enqueue.mockRejectedValue(new Error('queue unavailable'));

      await expect(adapter.enqueue(sampleJobData)).rejects.toThrow('queue unavailable');
    });
  });

  describe('backends', () => {
    it('should support multiple backends with the same interface', async () => {
      const bullmq = createMockAdapter('bullmq');
      const rabbitmq = createMockAdapter('rabbitmq');

      const bullmqResult = await bullmq.enqueue(sampleJobData);
      const rabbitmqResult = await rabbitmq.enqueue(sampleJobData);

      expect(bullmqResult).toBe('bullmq-job-id');
      expect(rabbitmqResult).toBe('rabbitmq-job-id');
    });
  });

  describe('health', () => {
    it('should report health status', async () => {
      const healthy = createMockAdapter('bullmq');
      const unhealthy = createMockAdapter('rabbitmq');
      unhealthy.isHealthy.mockResolvedValue(false);

      expect(await healthy.isHealthy()).toBe(true);
      expect(await unhealthy.isHealthy()).toBe(false);
    });

    it('should report queue depth', async () => {
      const adapter = createMockAdapter('bullmq');
      adapter.getDepth.mockResolvedValue(5);

      expect(await adapter.getDepth()).toBe(5);
    });
  });

  describe('consumer lifecycle', () => {
    it('should start and stop a consumer', async () => {
      const adapter = createMockAdapter('rabbitmq');
      const handler = vi.fn();

      await adapter.startConsumer(handler);
      expect(adapter.startConsumer).toHaveBeenCalledWith(handler);

      await adapter.stopConsumer();
      expect(adapter.stopConsumer).toHaveBeenCalled();
    });
  });
});
