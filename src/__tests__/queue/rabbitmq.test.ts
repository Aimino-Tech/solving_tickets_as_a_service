import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    queue: {
      rabbitmqUrl: 'amqp://guest:guest@localhost:5672/syntaro',
      backend: 'rabbitmq' as const,
    },
  },
}));

vi.mock('amqplib', () => {
  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue', messageCount: 0, consumerCount: 0 }),
    bindQueue: vi.fn().mockResolvedValue({}),
    publish: vi.fn().mockReturnValue(true),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'tag-1' }),
    cancel: vi.fn().mockResolvedValue({}),
    ack: vi.fn(),
    nack: vi.fn(),
    checkQueue: vi.fn().mockResolvedValue({ queue: 'test-queue', messageCount: 5, consumerCount: 1 }),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  };

  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue({}),
  };

  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockConnection),
    },
    connect: vi.fn().mockResolvedValue(mockConnection),
  };
});

describe('rabbitmq module', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('connects to RabbitMQ successfully', async () => {
    const rmq = await import('../../queue/rabbitmq.js');
    await rmq.connect();
    expect(rmq.isConnected()).toBe(true);
    await rmq.disconnect();
    expect(rmq.isConnected()).toBe(false);
  });

  it('publishes a message', async () => {
    const rmq = await import('../../queue/rabbitmq.js');
    await rmq.connect();

    const result = await rmq.publishMessage('syntaro.direct', 'issue.fix', { test: true });
    expect(result).toBe(true);

    await rmq.disconnect();
  });

  it('declares topology', async () => {
    const rmq = await import('../../queue/rabbitmq.js');
    await rmq.connect();

    await expect(rmq.declareTopology()).resolves.toBeUndefined();

    await rmq.disconnect();
  });

  it('consumes from a queue', async () => {
    const rmq = await import('../../queue/rabbitmq.js');
    await rmq.connect();

    const handler = vi.fn().mockResolvedValue(undefined);
    const consumerTag = await rmq.consumeQueue('syntaro.issues.fix', handler);
    expect(consumerTag).toBe('tag-1');

    await rmq.cancelConsumer(consumerTag);
    await rmq.disconnect();
  });

  it('gets queue depth', async () => {
    const rmq = await import('../../queue/rabbitmq.js');
    await rmq.connect();

    const depth = await rmq.getQueueDepth('syntaro.issues.fix');
    expect(depth).toBe(5);

    await rmq.disconnect();
  });
});
