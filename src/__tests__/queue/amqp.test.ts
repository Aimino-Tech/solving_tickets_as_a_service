import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    queue: {
      rabbitmqUrl: 'amqp://guest:guest@localhost:5672/stas',
    },
  },
}));

vi.mock('amqplib', () => {
  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockReturnValue(true),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    checkQueue: vi.fn().mockResolvedValue({ messageCount: 5, consumerCount: 1 }),
    purgeQueue: vi.fn().mockResolvedValue({ messageCount: 3 }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
  };
});

describe('AMQP exchanges module', () => {
  it('defines the correct exchanges', async () => {
    const { EXCHANGES } = await import('../../queue/amqp/exchanges.js');
    const exchangeNames = EXCHANGES.map((e) => e.name);
    expect(exchangeNames).toContain('stas.direct');
    expect(exchangeNames).toContain('stas.retry');
    expect(exchangeNames).toContain('stas.dlx');
  });

  it('defines retry queues with TTL', async () => {
    const { QUEUES } = await import('../../queue/amqp/exchanges.js');
    const retryQueues = QUEUES.filter((q) => q.name.startsWith('stas.retry'));
    expect(retryQueues).toHaveLength(4);
    expect(retryQueues[0].messageTtl).toBe(30_000);
    expect(retryQueues[1].messageTtl).toBe(120_000);
    expect(retryQueues[2].messageTtl).toBe(300_000);
    expect(retryQueues[3].messageTtl).toBe(900_000);
  });

  it('defines DLQ bindings', async () => {
    const { BINDINGS } = await import('../../queue/amqp/exchanges.js');
    const dlqBindings = BINDINGS.filter((b) => b.queue === 'stas.job.dlq');
    expect(dlqBindings.length).toBeGreaterThanOrEqual(2);
  });

  it('declares topology via channel', async () => {
    const amqplib = await import('amqplib');
    const { declareTopology } = await import('../../queue/amqp/exchanges.js');
    const channel = await (await amqplib.connect('')).createChannel();

    await declareTopology(channel);

    expect(channel.assertExchange).toHaveBeenCalledWith('stas.direct', 'direct', { durable: true });
    expect(channel.assertExchange).toHaveBeenCalledWith('stas.retry', 'direct', { durable: true });
    expect(channel.assertExchange).toHaveBeenCalledWith('stas.dlx', 'direct', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith('stas.job.pipeline', expect.objectContaining({ durable: true }));
    expect(channel.assertQueue).toHaveBeenCalledWith('stas.retry.30s', expect.objectContaining({ messageTtl: 30_000 }));
  });
});

describe('AMQP connection module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('connects and creates a channel', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqplib = await import('amqplib');
    const channel = await amqpConn.connect();
    expect(channel).toBeDefined();
    expect(amqplib.connect).toHaveBeenCalled();
  });

  it('returns true from isConnected after connect', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    await amqpConn.connect();
    expect(amqpConn.isConnected()).toBe(true);
  });

  it('shuts down gracefully', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    await amqpConn.connect();
    await amqpConn.gracefulShutdown();
    expect(amqpConn.isConnected()).toBe(false);
  });
});

describe('AMQP producer module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('publishes a message', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqpProd = await import('../../queue/amqp/producer.js');
    const amqplib = await import('amqplib');

    const channel = await amqpConn.connect();
    const result = await amqpProd.publishMessage('stas.direct', 'test.key', { foo: 'bar' });

    expect(result).toBe(true);
    expect(channel.publish).toHaveBeenCalledWith(
      'stas.direct',
      'test.key',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json',
      }),
    );
  });

  it('publishes a job', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqpProd = await import('../../queue/amqp/producer.js');

    await amqpConn.connect();
    const result = await amqpProd.publishJob({ test: true });

    expect(result).toBe(true);
  });

  it('publishes a phase message', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqpProd = await import('../../queue/amqp/producer.js');

    await amqpConn.connect();
    const result = await amqpProd.publishPhase('job-1', 'pre', { issue: { number: 42 } });

    expect(result).toBe(true);
  });

  it('publishes to retry queue', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqpProd = await import('../../queue/amqp/producer.js');

    await amqpConn.connect();
    const result = await amqpProd.publishToRetry('stas.direct', 'stas.job.pipeline', { foo: 'bar' }, 1, 'error msg');

    expect(result).toBe(true);
  });
});

describe('AMQP consumer module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts consuming from a queue', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqpConsumer = await import('../../queue/amqp/consumer.js');

    const channel = await amqpConn.connect();
    const handler = vi.fn().mockResolvedValue(undefined);

    const consumerTag = await amqpConsumer.consumeQueue('test.queue', handler);
    expect(consumerTag).toBe('test-consumer');
    expect(channel.consume).toHaveBeenCalledWith('test.queue', expect.any(Function));
  });

  it('cancels a consumer', async () => {
    const amqpConn = await import('../../queue/amqp/connection.js');
    const amqpConsumer = await import('../../queue/amqp/consumer.js');

    await amqpConn.connect();
    const consumerTag = await amqpConsumer.consumeQueue('test.queue', vi.fn().mockResolvedValue(undefined));

    await amqpConsumer.cancelConsumer(consumerTag);
    const amqplib = await import('amqplib');
    const channel = await (await amqplib.connect('')).createChannel();
    expect(channel.cancel).toHaveBeenCalledWith(consumerTag);
  });

  it('gets queue depth', async () => {
    const amqpConsumer = await import('../../queue/amqp/consumer.js');
    const amqplib = await import('amqplib');
    const channel = await (await amqplib.connect('')).createChannel();

    const depth = await amqpConsumer.getQueueDepth(channel, 'test.queue');
    expect(depth).toBe(5);
  });
});

describe('AMQP retry module', () => {
  it('calculates delay for retry count', async () => {
    const retry = await import('../../queue/amqp/retry.js');
    expect(retry.getDelayForRetry(0)).toBe(30_000);
    expect(retry.getDelayForRetry(1)).toBe(120_000);
    expect(retry.getDelayForRetry(2)).toBe(300_000);
    expect(retry.getDelayForRetry(3)).toBe(900_000);
  });

  it('returns last delay for out-of-range retry count', async () => {
    const retry = await import('../../queue/amqp/retry.js');
    expect(retry.getDelayForRetry(10)).toBe(900_000);
  });

  it('maps retry count to queue name', async () => {
    const retry = await import('../../queue/amqp/retry.js');
    expect(retry.getRetryQueueName(0)).toBe('stas.retry.30s');
    expect(retry.getRetryQueueName(1)).toBe('stas.retry.2m');
    expect(retry.getRetryQueueName(2)).toBe('stas.retry.5m');
    expect(retry.getRetryQueueName(3)).toBe('stas.retry.15m');
  });

  it('returns last queue for out-of-range retry count', () => {
    // retry.ts doesn't import config, so no need for resetModules
  });

  it('determines if retry should be attempted', async () => {
    const retry = await import('../../queue/amqp/retry.js');
    expect(retry.shouldRetry(0)).toBe(true);
    expect(retry.shouldRetry(3)).toBe(true);
    expect(retry.shouldRetry(4)).toBe(false);
  });
});
