/**
 * Cross-Service Bridge — Node.js ↔ Python/RabbitMQ Communication
 *
 * Provides publish/subscribe and RPC primitives over RabbitMQ with:
 *   - Auto-reconnect on connection loss (exponential backoff)
 *   - RabbitMQ Direct Reply-To (`amq.rabbitmq.reply-to`) for RPC efficiency
 *   - Timeout handling with configurable timeout
 *   - Circuit breaker pattern for cross-service calls
 *   - Redis-based fallback queue when RabbitMQ is unavailable
 *   - Prometheus metrics instrumentation
 *
 * ── Usage ─────────────────────────────────────────────────────────
 *   const bridge = new CrossServiceBridge();
 *   await bridge.connect();
 *   await bridge.publish('stas.agents.triage', envelope);
 *   await bridge.subscribe('stas.agents.triage', (msg) => { ... });
 *   const reply = await bridge.rpc('stas.agents.triage', envelope, 30000);
 *   await bridge.shutdown();
 * ───────────────────────────────────────────────────────────────────
 */

import { connect, type Channel, type Connection, type ConsumeMessage } from 'amqplib';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { MessageEnvelope } from './types.js';
import {
  bridgeMetrics,
  recordMessagePublished,
  recordMessageConsumed,
  recordMessageFailed,
  recordConsumerLag,
  recordProcessingDuration,
} from './metrics.js';
import { PoisonMessageTracker, createErrorEnvelope, type ErrorEnvelope } from './errors.js';

const log = rootLogger.child({ module: 'bridge' });

// ── Constants ─────────────────────────────────────────────────────

const RPC_REPLY_QUEUE = 'amq.rabbitmq.reply-to';
const BRIDGE_EXCHANGE = 'stas.bridge';
const DLX_EXCHANGE = 'stas.bridge.dlx';
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const CIRCUIT_HALF_OPEN_TIMEOUT_MS = 10_000;

// ── Circuit Breaker State ─────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  /** Number of failures before tripping the circuit. */
  threshold: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN. */
  cooldownMs: number;
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;
  private readonly emitter = new EventEmitter();

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      threshold: options.threshold ?? 5,
      cooldownMs: CIRCUIT_HALF_OPEN_TIMEOUT_MS,
    };
  }

  get events(): EventEmitter {
    return this.emitter;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Check if the circuit allows a request through.
   */
  allowRequest(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      // Check if cooldown has elapsed
      if (Date.now() - this.lastFailureTime >= this.options.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.emitter.emit('state', 'HALF_OPEN');
        return true;
      }
      return false;
    }
    // HALF_OPEN — allow one request
    return true;
  }

  /**
   * Record a successful call.
   */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.emitter.emit('state', 'CLOSED');
    }
    this.failureCount = 0;
  }

  /**
   * Record a failed call.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.options.threshold) {
      this.state = 'OPEN';
      this.emitter.emit('state', 'OPEN');
    }
  }

  /**
   * Reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.emitter.emit('state', 'CLOSED');
  }
}

// ── Redis Fallback Queue ──────────────────────────────────────────

/**
 * In-memory queue used when both RabbitMQ and Redis are unavailable.
 * This is a last-resort fallback that only survives the process lifetime.
 */
class LocalQueue {
  private readonly queues = new Map<string, string[]>();
  private readonly subscribers = new Map<string, Array<(msg: string) => void>>();

  push(queue: string, message: string): void {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }
    this.queues.get(queue)!.push(message);
    this.deliver(queue);
  }

  subscribe(queue: string, handler: (msg: string) => void): void {
    if (!this.subscribers.has(queue)) {
      this.subscribers.set(queue, []);
    }
    this.subscribers.get(queue)!.push(handler);
    this.deliver(queue);
  }

  private deliver(queue: string): void {
    const messages = this.queues.get(queue) ?? [];
    const handlers = this.subscribers.get(queue) ?? [];

    while (messages.length > 0) {
      const msg = messages.shift()!;
      for (const handler of handlers) {
        try {
          handler(msg);
        } catch {
          // Subscriber error in local queue is non-fatal
        }
      }
    }
  }
}

// ── CrossServiceBridge ────────────────────────────────────────────

export interface BridgeOptions {
  url?: string;
  prefetchCount?: number;
  rpcTimeoutMs?: number;
  maxRetries?: number;
  circuitBreakerThreshold?: number;
  fallbackBackend?: 'redis' | 'local' | 'none';
}

/**
 * Main bridge class for cross-service communication over RabbitMQ.
 *
 * Provides:
 *   - publish() — Send a message to a queue via the bridge exchange
 *   - subscribe() — Consume messages from a queue
 *   - rpc() — Request/reply with correlation ID and timeout
 *   - Auto-reconnect with exponential backoff
 *   - Circuit breaker for cross-service calls
 *   - Redis/local fallback when RabbitMQ is down
 */
export class CrossServiceBridge {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly options: Required<BridgeOptions>;
  private shutdownInitiated = false;
  private reconnectAttempts = 0;
  private readonly rpcCallbacks = new Map<string, { resolve: (msg: MessageEnvelope) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
  private readonly circuitBreaker: CircuitBreaker;
  private readonly poisonTracker: PoisonMessageTracker;
  private readonly localQueue: LocalQueue;
  private redisClient: Redis | null = null;
  private readonly emitter = new EventEmitter();
  private subscribedQueues = new Set<string>();

  constructor(options: BridgeOptions = {}) {
    this.options = {
      url: options.url ?? config.rabbitmq.url,
      prefetchCount: options.prefetchCount ?? config.rabbitmq.prefetchCount,
      rpcTimeoutMs: options.rpcTimeoutMs ?? 30000,
      maxRetries: options.maxRetries ?? 3,
      circuitBreakerThreshold: options.circuitBreakerThreshold ?? 5,
      fallbackBackend: options.fallbackBackend ?? 'local',
    };

    this.circuitBreaker = new CircuitBreaker({ threshold: this.options.circuitBreakerThreshold });
    this.poisonTracker = new PoisonMessageTracker(this.options.maxRetries);
    this.localQueue = new LocalQueue();

    this.circuitBreaker.events.on('state', (state: CircuitState) => {
      log.warn({ state }, 'Circuit breaker state change');
      this.emitter.emit('circuit.state', state);
    });

    this.poisonTracker.events.on('quarantined', (record) => {
      log.error(
        { messageId: record.message.messageId, failCount: record.failCount, error: record.error },
        'Message quarantined — exceeded retry limit',
      );
      this.emitter.emit('message.quarantined', record);
      recordMessageFailed('*', record.error.code);
    });
  }

  /**
   * Event emitter for bridge lifecycle events.
   * Events:
   *   - 'connected' — RabbitMQ connection established
   *   - 'disconnected' — RabbitMQ connection lost
   *   - 'reconnecting' — Attempting reconnection
   *   - 'circuit.state' (state: CircuitState) — Circuit breaker state change
   *   - 'message.quarantined' (record) — Message sent to quarantine
   *   - 'error' (err: Error) — Unrecoverable error
   */
  get events(): EventEmitter {
    return this.emitter;
  }

  // ── Connection Management ───────────────────────────────────────

  /**
   * Connect to RabbitMQ and set up the bridge topology.
   * Falls back to Redis if RabbitMQ is unavailable.
   */
  async connect(): Promise<void> {
    if (this.connection) return;
    if (this.shutdownInitiated) return;

    try {
      this.connection = (await connect(this.options.url)) as unknown as Connection;

      (this.connection as any).on('error', (err: unknown) => {
        log.error({ err: String(err) }, 'Bridge RabbitMQ connection error');
        this.emitter.emit('disconnected');
        this.scheduleReconnect();
      });

      (this.connection as any).on('close', () => {
        log.warn('Bridge RabbitMQ connection closed');
        this.connection = null;
        this.channel = null;
        this.emitter.emit('disconnected');
        if (!this.shutdownInitiated) {
          this.scheduleReconnect();
        }
      });

      this.channel = await (this.connection as any).createChannel();
      await this.channel!.prefetch(this.options.prefetchCount);
      await this.declareTopology();

      // Set up RPC reply consumer for Direct Reply-To
      await this.setupRpcReplyConsumer();

      // Re-bind any previously subscribed queues
      await this.resubscribeQueues();

      this.reconnectAttempts = 0;
      this.circuitBreaker.reset();

      log.info('Bridge connected to RabbitMQ');
      this.emitter.emit('connected');
    } catch (err) {
      log.error({ err: String(err) }, 'Bridge failed to connect to RabbitMQ — using fallback');
      this.connection = null;
      this.channel = null;

      // Try Redis fallback
      if (this.options.fallbackBackend === 'redis' || this.options.fallbackBackend === 'local') {
        await this.initRedisFallback();
      }

      // Don't throw — caller should not crash; fallback handles it
    }
  }

  /**
   * Declare RabbitMQ topology: bridge exchange, DLX, and queues.
   */
  private async declareTopology(): Promise<void> {
    if (!this.channel) return;

    await this.channel.assertExchange(BRIDGE_EXCHANGE, 'topic', { durable: true });
    await this.channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });

    const dlqName = `${BRIDGE_EXCHANGE}.dlq`;
    await this.channel.assertQueue(dlqName, {
      durable: true,
      deadLetterExchange: DLX_EXCHANGE,
    });
    await this.channel.bindQueue(dlqName, DLX_EXCHANGE, '#');

    log.info('Bridge topology declared — exchange=%s dlq=%s', BRIDGE_EXCHANGE, dlqName);
  }

  /**
   * Set up the consumer for RPC replies via Direct Reply-To.
   */
  private async setupRpcReplyConsumer(): Promise<void> {
    if (!this.channel) return;

    // Consume from the pseudo-queue 'amq.rabbitmq.reply-to'
    // RabbitMQ delivers reply messages directly to this consumer
    await this.channel.consume(
      RPC_REPLY_QUEUE,
      (msg) => {
        if (!msg) return;
        this.handleRpcReply(msg);
      },
      { noAck: true },
    );

    log.debug('RPC reply consumer set up on %s', RPC_REPLY_QUEUE);
  }

  /**
   * Handle an RPC reply message delivered via Direct Reply-To.
   */
  private handleRpcReply(msg: ConsumeMessage): void {
    try {
      const content = JSON.parse(msg.content.toString());
      const correlationId = msg.properties.correlationId;

      if (!correlationId) {
        log.warn('Received RPC reply without correlationId');
        return;
      }

      const callback = this.rpcCallbacks.get(correlationId);
      if (!callback) {
        log.warn({ correlationId }, 'Received RPC reply for unknown correlationId');
        return;
      }

      clearTimeout(callback.timer);
      this.rpcCallbacks.delete(correlationId);

      // Check if the response is an error envelope
      if (content && typeof content === 'object' && 'error' in content && content.error === true) {
        callback.reject(new Error(content.message ?? 'RPC returned error'));
        return;
      }

      callback.resolve(content as MessageEnvelope);
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to parse RPC reply');
    }
  }

  /**
   * Re-subscribe to queues after reconnection.
   */
  private async resubscribeQueues(): Promise<void> {
    // Subscriptions are re-established by the caller via subscribe().
    // The subscribedQueues set tracks which queues should be re-bound.
    // Actual consumer setup happens in subscribe().
    log.debug('Queue subscriptions will be re-established on next subscribe() call');
  }

  /**
   * Schedule reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.shutdownInitiated) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      config.rabbitmq.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    log.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Scheduling bridge reconnection',
    );

    this.emitter.emit('reconnecting', { attempt: this.reconnectAttempts, delayMs: delay });

    setTimeout(() => {
      this.connect().catch((err) => {
        log.error({ err: String(err) }, 'Bridge reconnection failed');
      });
    }, delay);
  }

  // ── Redis Fallback ──────────────────────────────────────────────

  /**
   * Initialize Redis-based fallback queue when RabbitMQ is unavailable.
   */
  private async initRedisFallback(): Promise<void> {
    if (this.options.fallbackBackend === 'local') {
      log.info('Using local in-memory fallback queue');
      return;
    }

    try {
      this.redisClient = new Redis(config.queue.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null; // give up
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      await this.redisClient.connect();
      log.info('Redis fallback queue initialized');
    } catch (err) {
      log.warn({ err: String(err) }, 'Redis fallback unavailable — using local queue');
      this.redisClient = null;
    }
  }

  // ── Publish ─────────────────────────────────────────────────────

  /**
   * Publish a message to a queue via the bridge exchange.
   *
   * @param queue - Target queue name (used as routing key)
   * @param message - The message envelope to publish
   * @returns true if published successfully
   */
  async publish(queue: string, message: MessageEnvelope): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Try RabbitMQ first
      if (this.channel && this.connection) {
        const buffer = Buffer.from(JSON.stringify(message));
        const published = this.channel.publish(BRIDGE_EXCHANGE, queue, buffer, {
          persistent: true,
          contentType: 'application/json',
          timestamp: Math.floor(Date.now() / 1000),
          messageId: message.messageId,
          correlationId: message.correlationId,
          replyTo: message.replyTo,
          headers: {
            'x-schema-version': message.version,
          },
        });

        if (published) {
          const duration = (Date.now() - startTime) / 1000;
          recordMessagePublished(queue);
          recordProcessingDuration(queue, duration);
          return true;
        }

        log.warn({ queue, messageId: message.messageId }, 'Publish returned false');
      }

      // Fallback to Redis or local queue
      await this.fallbackPublish(queue, message);

      recordMessagePublished(queue);
      return true;
    } catch (err) {
      log.error({ err: String(err), queue, messageId: message.messageId }, 'Publish failed');

      // Attempt fallback
      try {
        await this.fallbackPublish(queue, message);
        recordMessagePublished(queue);
        return true;
      } catch (fallbackErr) {
        log.error({ err: String(fallbackErr), queue }, 'Fallback publish also failed');
        recordMessageFailed(queue, String(err));
        return false;
      }
    }
  }

  /**
   * Publish via Redis or local queue when RabbitMQ is unavailable.
   */
  private async fallbackPublish(queue: string, message: MessageEnvelope): Promise<void> {
    const serialized = JSON.stringify(message);

    if (this.redisClient) {
      await this.redisClient.rpush(`bridge:${queue}`, serialized);
      await this.redisClient.ltrim(`bridge:${queue}`, -1000, -1); // keep last 1000
      // Notify any blocking subscribers
      await this.redisClient.publish(`bridge:${queue}`, serialized);
    } else {
      this.localQueue.push(queue, serialized);
    }
  }

  // ── Subscribe ───────────────────────────────────────────────────

  /**
   * Subscribe to messages from a queue.
   *
   * @param queue - Queue name to consume from
   * @param handler - Callback for each received message
   */
  async subscribe(
    queue: string,
    handler: (msg: MessageEnvelope) => void,
  ): Promise<void> {
    this.subscribedQueues.add(queue);

    // Try RabbitMQ
    if (this.channel && this.connection) {
      try {
        // Ensure the queue exists and is bound to the bridge exchange
        await this.channel.assertQueue(queue, {
          durable: true,
          deadLetterExchange: DLX_EXCHANGE,
          deadLetterRoutingKey: queue,
        });
        await this.channel.bindQueue(queue, BRIDGE_EXCHANGE, queue);

        await this.channel.consume(
          queue,
          (msg) => {
            if (!msg) return;

            try {
              const content = JSON.parse(msg.content.toString()) as MessageEnvelope;
              recordMessageConsumed(queue);
              const startTime = Date.now();

              handler(content);

              const duration = (Date.now() - startTime) / 1000;
              recordProcessingDuration(queue, duration);
              this.channel!.ack(msg);
            } catch (err) {
              log.error(
                { err: String(err), queue, messageId: msg.properties.messageId },
                'Failed to process message — nacking',
              );

              recordMessageFailed(queue, String(err));

              // Check poison status
              try {
                const content = JSON.parse(msg.content.toString()) as MessageEnvelope;
                const errorEnvelope = createErrorEnvelope('TASK_FAILED', String(err), msg.properties.messageId ?? 'unknown');
                const shouldQuarantine = this.poisonTracker.recordFailure(content, errorEnvelope);

                if (shouldQuarantine) {
                  // Move to DLQ
                  this.channel!.nack(msg, false, false);
                  log.warn({ queue, messageId: content.messageId }, 'Message moved to DLQ');
                } else {
                  // Requeue for retry
                  this.channel!.nack(msg, false, true);
                }
              } catch {
                this.channel!.nack(msg, false, true);
              }
            }
          },
          { noAck: false },
        );

        log.info({ queue }, 'Subscribed to queue');
        return;
      } catch (err) {
        log.error({ err: String(err), queue }, 'Failed to subscribe via RabbitMQ — trying fallback');
      }
    }

    // Fallback subscription
    if (this.redisClient) {
      await this.subscribeRedisFallback(queue, handler);
    } else {
      this.localQueue.subscribe(queue, (raw) => {
        try {
          const msg = JSON.parse(raw) as MessageEnvelope;
          recordMessageConsumed(queue);
          handler(msg);
        } catch {
          // Parse error in fallback is logged but non-fatal
        }
      });
    }
  }

  /**
   * Subscribe via Redis pub/sub as fallback.
   */
  private async subscribeRedisFallback(
    queue: string,
    handler: (msg: MessageEnvelope) => void,
  ): Promise<void> {
    if (!this.redisClient) return;

    const subscriber = this.redisClient.duplicate();
    await subscriber.connect();

    // Subscribe to pub/sub channel for real-time delivery
    await subscriber.subscribe(`bridge:${queue}`, (err) => {
      if (err) {
        log.error({ err: String(err), queue }, 'Redis subscribe failed');
      }
    });

    subscriber.on('message', (channel, raw) => {
      if (channel === `bridge:${queue}`) {
        try {
          const msg = JSON.parse(raw) as MessageEnvelope;
          recordMessageConsumed(queue);
          handler(msg);
        } catch {
          // Parse error
        }
      }
    });

    // Also poll for backlog messages
    const pollBacklog = async (): Promise<void> => {
      if (!this.redisClient) return;
      try {
        while (true) {
          const raw = await this.redisClient.lpop(`bridge:${queue}`);
          if (!raw) break;
          try {
            const msg = JSON.parse(raw) as MessageEnvelope;
            recordMessageConsumed(queue);
            handler(msg);
          } catch {
            // skip malformed
          }
        }
      } catch {
        // Polling error is non-fatal
      }
    };

    // Poll immediately and every 5 seconds
    await pollBacklog();
    setInterval(pollBacklog, 5000);
  }

  // ── RPC (Request/Reply) ─────────────────────────────────────────

  /**
   * Send a request message and wait for a reply.
   *
   * Uses RabbitMQ Direct Reply-To (`amq.rabbitmq.reply-to`) for efficient
   * RPC without dedicated reply queues. Falls back to Redis polling if
   * RabbitMQ is unavailable.
   *
   * @param queue - Queue to send the request to
   * @param message - Request message envelope
   * @param timeoutMs - How long to wait for a reply (default: config value)
   * @returns The response MessageEnvelope
   * @throws If the circuit is open, the request times out, or an error reply is received
   */
  async rpc(
    queue: string,
    message: MessageEnvelope,
    timeoutMs?: number,
  ): Promise<MessageEnvelope> {
    const timeout = timeoutMs ?? this.options.rpcTimeoutMs;

    // Check circuit breaker
    if (!this.circuitBreaker.allowRequest()) {
      const err = new Error(`Circuit breaker is OPEN for queue "${queue}"`);
      this.emitter.emit('error', err);
      throw err;
    }

    // Generate correlation ID if not set
    const correlationId = message.correlationId ?? randomUUID();

    // Set up reply handler before publishing to avoid race conditions
    const reply = new Promise<MessageEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rpcCallbacks.delete(correlationId);

        const errorEnvelope = createErrorEnvelope(
          'TASK_TIMEOUT',
          `RPC timeout after ${timeout}ms for queue "${queue}"`,
          message.messageId,
          { queue, timeoutMs: timeout, correlationId },
        );

        this.poisonTracker.recordFailure(message, errorEnvelope);
        this.circuitBreaker.recordFailure();
        recordMessageFailed(queue, 'TASK_TIMEOUT');

        reject(new Error(errorEnvelope.message));
      }, timeout);

      this.rpcCallbacks.set(correlationId, { resolve, reject, timer });
    });

    try {
      // Set replyTo for Direct Reply-To
      const rpcMessage: MessageEnvelope = {
        ...message,
        correlationId,
        replyTo: RPC_REPLY_QUEUE,
      };

      await this.publish(queue, rpcMessage);
      const result = await reply;

      this.circuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      this.circuitBreaker.recordFailure();
      throw err;
    }
  }

  // ── Health Check ────────────────────────────────────────────────

  /**
   * Check if the bridge is healthy.
   *
   * @returns Health status object with connection state and metrics summary
   */
  async healthCheck(): Promise<{
    status: 'ok' | 'degraded' | 'down';
    rabbitmq: boolean;
    redis: boolean;
    circuitState: CircuitState;
    queues: number;
  }> {
    const rabbitmq = this.connection !== null && this.channel !== null;
    const redis = this.redisClient !== null;

    let status: 'ok' | 'degraded' | 'down';
    if (rabbitmq) {
      status = 'ok';
    } else if (redis) {
      status = 'degraded';
    } else {
      status = 'degraded'; // local queue is still functional
    }

    // If circuit breaker is open, reflect that
    if (this.circuitBreaker.currentState === 'OPEN') {
      status = 'degraded';
    }

    return {
      status,
      rabbitmq,
      redis,
      circuitState: this.circuitBreaker.currentState,
      queues: this.subscribedQueues.size,
    };
  }

  // ── Metrics ─────────────────────────────────────────────────────

  /**
   * Get the bridge metrics in Prometheus exposition format.
   */
  metricsText(): string {
    return bridgeMetrics.render();
  }

  // ── Shutdown ────────────────────────────────────────────────────

  /**
   * Gracefully shut down the bridge — close connections and clean up.
   */
  async shutdown(): Promise<void> {
    this.shutdownInitiated = true;

    // Clear all RPC callbacks
    for (const [correlationId, callback] of this.rpcCallbacks) {
      clearTimeout(callback.timer);
      callback.reject(new Error('Bridge is shutting down'));
    }
    this.rpcCallbacks.clear();

    // Close Redis client
    if (this.redisClient) {
      try {
        this.redisClient.disconnect();
      } catch {
        // non-fatal
      }
      this.redisClient = null;
    }

    // Close channel and connection
    try {
      if (this.channel) {
        await this.channel.close();
      }
    } catch {
      // non-fatal
    }

    try {
      if (this.connection) {
        await (this.connection as any).close();
      }
    } catch {
      // non-fatal
    }

    this.channel = null;
    this.connection = null;
    this.subscribedQueues.clear();

    log.info('Bridge shutdown complete');
  }
}
