/**
 * Unit tests for src/bridge/bridge.ts — CrossServiceBridge class.
 *
 * Strategy: Mock amqplib and ioredis to test the bridge's behavior
 * without connecting to real RabbitMQ or Redis.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CrossServiceBridge } from '../../bridge/bridge.js';
import { createMessage, type MessageEnvelope } from '../../bridge/types.js';

// ── Mocks ─────────────────────────────────────────────────────────

const mockChannel = vi.hoisted(() => ({
  prefetch: vi.fn().mockResolvedValue(undefined),
  assertExchange: vi.fn().mockResolvedValue(undefined),
  assertQueue: vi.fn().mockResolvedValue({ queue: 'mock-queue' }),
  bindQueue: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockReturnValue(true),
  consume: vi.fn().mockResolvedValue({ consumerTag: 'mock-tag' }),
  ack: vi.fn(),
  nack: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}));

const mockConnection = vi.hoisted(() => ({
  createChannel: vi.fn().mockResolvedValue(mockChannel),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}));

vi.mock('amqplib', () => ({
  connect: vi.fn().mockResolvedValue(mockConnection),
}));

vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    rpush: vi.fn().mockResolvedValue(1),
    ltrim: vi.fn().mockResolvedValue('OK'),
    publish: vi.fn().mockResolvedValue(1),
    lpop: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    duplicate: vi.fn().mockReturnThis(),
  }));
  return { default: MockRedis, Redis: MockRedis };
});

vi.mock('../../config.js', () => ({
  config: {
    rabbitmq: {
      url: 'amqp://localhost:5672/stas',
      prefetchCount: 10,
      reconnectDelayMs: 5000,
      maxReconnectAttempts: 10,
    },
    bridge: {
      rpcTimeoutMs: 30000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
      fallbackBackend: 'redis' as const,
    },
    queue: {
      redisUrl: 'redis://localhost:6379',
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

// ── Tests ─────────────────────────────────────────────────────────

describe('CrossServiceBridge', () => {
  let bridge: CrossServiceBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new CrossServiceBridge({
      url: 'amqp://localhost:5672/stas',
      rpcTimeoutMs: 5000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
      fallbackBackend: 'none', // disable fallback for clean tests
    });
  });

  afterEach(async () => {
    await bridge.shutdown();
  });

  // ── connect() ────────────────────────────────────────────────────

  describe('connect()', () => {
    it('connects to RabbitMQ and declares topology', async () => {
      await bridge.connect();

      expect(mockConnection.createChannel).toHaveBeenCalledTimes(1);
      expect(mockChannel.prefetch).toHaveBeenCalledWith(10);
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'stas.bridge',
        'topic',
        { durable: true },
      );
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'stas.bridge.dlx',
        'direct',
        { durable: true },
      );
    });

    it('sets up RPC reply consumer on connect', async () => {
      await bridge.connect();
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'amq.rabbitmq.reply-to',
        expect.any(Function),
        { noAck: true },
      );
    });

    it('handles connection errors gracefully', async () => {
      const { connect } = await import('amqplib');
      (connect as any).mockRejectedValueOnce(new Error('Connection refused'));

      const localBridge = new CrossServiceBridge({ fallbackBackend: 'none' });
      await localBridge.connect();

      // Should not throw — bridge degrades gracefully
      const health = await localBridge.healthCheck();
      expect(health.rabbitmq).toBe(false);
      await localBridge.shutdown();
    });

    it('skips reconnection if already connected', async () => {
      await bridge.connect();
      const createChannelCalls = mockConnection.createChannel.mock.calls.length;

      await bridge.connect();
      expect(mockConnection.createChannel).toHaveBeenCalledTimes(createChannelCalls);
    });
  });

  // ── publish() ────────────────────────────────────────────────────

  describe('publish()', () => {
    beforeEach(async () => {
      await bridge.connect();
    });

    it('publishes a message to the bridge exchange', async () => {
      const msg = createMessage('job.fix', 'nodejs-webhook', { issueNumber: 42 });
      const result = await bridge.publish('stas.agents.triage', msg);

      expect(result).toBe(true);
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'stas.bridge',
        'stas.agents.triage',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
          messageId: msg.messageId,
          correlationId: msg.correlationId,
        }),
      );
    });

    it('returns false when publish fails and no fallback', async () => {
      mockChannel.publish.mockReturnValueOnce(false);
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const result = await bridge.publish('test-queue', msg);
      expect(result).toBe(false);
    });

    it('falls back to channel when publish throws', async () => {
      mockChannel.publish.mockImplementationOnce(() => {
        throw new Error('Channel error');
      });

      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const result = await bridge.publish('test-queue', msg);
      expect(result).toBe(false);
    });
  });

  // ── subscribe() ──────────────────────────────────────────────────

  describe('subscribe()', () => {
    beforeEach(async () => {
      await bridge.connect();
    });

    it('asserts and binds queue before consuming', async () => {
      const handler = vi.fn();
      await bridge.subscribe('test-queue', handler);

      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.objectContaining({ durable: true }),
      );
      expect(mockChannel.bindQueue).toHaveBeenCalledWith(
        'test-queue',
        'stas.bridge',
        'test-queue',
      );
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        { noAck: false },
      );
    });

    it('delivers messages to the handler', async () => {
      const handler = vi.fn();
      await bridge.subscribe('test-queue', handler);

      // Simulate message delivery
      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const consumeCall = mockChannel.consume.mock.calls[0][1];
      const consumeMessage = {
        content: Buffer.from(JSON.stringify(msg)),
        properties: { messageId: msg.messageId, correlationId: msg.correlationId },
      };
      consumeCall(consumeMessage);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        messageId: msg.messageId,
        type: 'job.fix',
      }));
      expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    });

    it('nacks messages that fail processing', async () => {
      const handler = vi.fn().mockImplementation(() => {
        throw new Error('Processing error');
      });

      await bridge.subscribe('test-queue', handler);

      const msg = createMessage('job.fix', 'nodejs-webhook', {});
      const consumeCall = mockChannel.consume.mock.calls[0][1];
      const consumeMessage = {
        content: Buffer.from(JSON.stringify(msg)),
        properties: { messageId: msg.messageId, correlationId: msg.correlationId },
      };
      consumeCall(consumeMessage);

      expect(mockChannel.nack).toHaveBeenCalled();
    });
  });

  // ── rpc() ────────────────────────────────────────────────────────

  describe('rpc()', () => {
    beforeEach(async () => {
      await bridge.connect();
    });

    it('sends a message and waits for reply', async () => {
      const msg = createMessage('job.triage', 'nodejs-webhook', {});
      const reply = createMessage('result.fix', 'python-worker', { status: 'done' });

      // Start RPC
      const rpcPromise = bridge.rpc('test-queue', msg, 5000);

      // Simulate reply via Direct Reply-To consumer
      const consumeCall = mockChannel.consume.mock.calls.find(
        (call: any) => call[0] === 'amq.rabbitmq.reply-to',
      );
      const replyConsumer = consumeCall ? consumeCall[1] : null;

      // Give the RPC setup time to register the callback
      await vi.waitFor(() => {
        expect(mockChannel.publish).toHaveBeenCalled();
      });

      // Simulate the reply
      if (replyConsumer) {
        replyConsumer({
          content: Buffer.from(JSON.stringify(reply)),
          properties: { correlationId: msg.correlationId },
        });
      }

      const result = await rpcPromise;
      expect(result).toBeDefined();
      expect(result.type).toBe('result.fix');
    });

    it('throws on timeout', async () => {
      const msg = createMessage('job.triage', 'nodejs-webhook', {});

      // Use very short timeout to trigger timeout
      await expect(
        bridge.rpc('test-queue', msg, 10),
      ).rejects.toThrow(/RPC timeout/);
    });
  });

  // ── Circuit Breaker ──────────────────────────────────────────────

  describe('circuit breaker', () => {
    beforeEach(async () => {
      bridge = new CrossServiceBridge({
        circuitBreakerThreshold: 2,
        rpcTimeoutMs: 100,
        fallbackBackend: 'none',
      });
      await bridge.connect();
    });

    it('opens after threshold failures', async () => {
      const msg = createMessage('job.fix', 'nodejs-webhook', {});

      // First two RPCs should fail with timeout
      await expect(bridge.rpc('test-queue', msg, 10)).rejects.toThrow();
      await expect(bridge.rpc('test-queue', msg, 10)).rejects.toThrow();

      // Circuit should be open — third call should fail immediately
      await expect(bridge.rpc('test-queue', msg, 5000)).rejects.toThrow(/Circuit breaker is OPEN/);
    });

    it('resets after successful call', async () => {
      const msg = createMessage('job.fix', 'nodejs-webhook', {});

      // The circuit should be closed for successful publish
      // Since publish returns true, circuit records success
      await bridge.publish('test-queue', msg);

      // Circuit should be closed
      const health = await bridge.healthCheck();
      expect(health.circuitState).toBe('CLOSED');
    });
  });

  // ── healthCheck() ────────────────────────────────────────────────

  describe('healthCheck()', () => {
    it('returns ok when connected', async () => {
      await bridge.connect();
      const health = await bridge.healthCheck();
      expect(health.status).toBe('ok');
      expect(health.rabbitmq).toBe(true);
    });

    it('returns degraded when not connected', async () => {
      const health = await bridge.healthCheck();
      expect(health.status).toBe('degraded');
      expect(health.rabbitmq).toBe(false);
    });
  });

  // ── shutdown() ───────────────────────────────────────────────────

  describe('shutdown()', () => {
    it('closes channel and connection gracefully', async () => {
      await bridge.connect();
      await bridge.shutdown();

      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('is safe to call multiple times', async () => {
      await bridge.shutdown();
      await bridge.shutdown(); // second call should not throw
    });
  });
});
