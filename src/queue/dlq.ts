/**
 * Dead Letter Queue Consumer — consumes and replays messages from RabbitMQ DLX.
 *
 * Exchange topology:
 *   - DLX per queue -> dead letter exchange `stas.dlx`
 *   - `stas.retry` exchange for replayable messages
 *   - Deduplication via Redis message_id set
 *
 * Usage:
 *   const consumer = new DLQConsumer();
 *   await consumer.consumeDLQ();
 */

import { connect as amqpConnect, type Channel, type ConsumeMessage } from 'amqplib';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import { publish } from './rabbitmq.js';

const log = rootLogger.child({ module: 'dlq-consumer' });

// ── Types ───────────────────────────────────────────────────────────

export interface DLQMessage {
  messageId: string;
  retryCount: number;
  originalExchange: string;
  originalRoutingKey: string;
  originalQueue: string;
  payload: unknown;
  error?: string;
  timestamp: string;
}

// ── Constants ───────────────────────────────────────────────────────

const DLQ_PREFIX = 'stas.dlx';
const RETRY_EXCHANGE = 'stas.retry';
const DEDUP_PREFIX = 'stas:dlq:dedup:';
const DEDUP_TTL_SECONDS = 3600; // 1 hour dedup window

// ── DLQConsumer ─────────────────────────────────────────────────────

export class DLQConsumer {
  private readonly redis: Redis;
  private channel: Channel | null = null;
  private consuming = false;

  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl ?? config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, 'DLQ Redis connection retry in ${delay}ms');
        return delay;
      },
      lazyConnect: true,
    });
  }

  /**
   * Start consuming from the dead letter queue.
   * Reads from the `stas.dlx` exchange and processes messages.
   */
  async consumeDLQ(): Promise<void> {
    if (this.consuming) {
      log.warn('DLQ consumer already running');
      return;
    }

    try {
      const connection = await amqpConnect(config.queue.rabbitmqUrl);
      this.channel = await connection.createChannel();

      // Assert the retry exchange
      await this.channel.assertExchange(RETRY_EXCHANGE, 'topic', { durable: true });

      // Assert the DLX exchange
      await this.channel.assertExchange(DLQ_PREFIX, 'direct', { durable: true });

      // Create a queue bound to the DLX for all dead-lettered messages
      const { queue } = await this.channel.assertQueue('stas.dlx.consumer', {
        durable: true,
        arguments: {
          'x-message-ttl': 86400000, // 24h TTL
        },
      });

      // Bind to all DLQ routing keys
      await this.channel.bindQueue(queue, DLQ_PREFIX, '#');

      this.consuming = true;
      log.info('Started DLQ consumer — listening on stas.dlx exchange');

      await this.channel.consume(queue, async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const dlqMessage = this.parseMessage(msg);
          if (!dlqMessage) {
            this.channel?.ack(msg);
            return;
          }

          // Check for duplicates
          const isDup = await this.isDuplicate(dlqMessage);
          if (isDup) {
            log.warn({ messageId: dlqMessage.messageId }, 'Skipping duplicate DLQ message');
            this.channel?.ack(msg);
            bridgeMetrics.incrementCounter('dlq_duplicates_total', {});
            return;
          }

          // Process the message
          await this.replayMessage(dlqMessage);
          this.channel?.ack(msg);

          bridgeMetrics.incrementCounter('dlq_replayed_total', {
            queue: dlqMessage.originalQueue,
          });
        } catch (err) {
          log.error({ err: String(err) }, 'Failed to process DLQ message');
          // Don't ack — let it be retried by RabbitMQ
          this.channel?.nack(msg, false, true);
        }
      });

      connection.on('error', (err) => {
        log.error({ err: String(err) }, 'DLQ consumer connection error');
        this.consuming = false;
      });
      connection.on('close', () => {
        log.warn('DLQ consumer connection closed');
        this.consuming = false;
      });
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to start DLQ consumer');
      this.consuming = false;
      throw err;
    }
  }

  /**
   * Parse a raw RabbitMQ message into a DLQMessage.
   */
  private parseMessage(msg: ConsumeMessage): DLQMessage | null {
    try {
      const content = JSON.parse(msg.content.toString());
      const headers = msg.properties.headers ?? {};

      return {
        messageId: headers['message-id'] ?? `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        retryCount: (headers['retry-count'] as number) ?? 0,
        originalExchange: headers['x-first-death-exchange'] ?? msg.fields.exchange ?? 'unknown',
        originalRoutingKey: headers['x-first-death-routing-key'] ?? msg.fields.routingKey ?? 'unknown',
        originalQueue: headers['x-first-death-queue'] ?? 'unknown',
        payload: content,
        error: headers['x-exception-message'] as string | undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to parse DLQ message');
      return null;
    }
  }

  /**
   * Check if a message is a duplicate using Redis.
   * Uses a SET to track message IDs with TTL.
   */
  async isDuplicate(message: DLQMessage): Promise<boolean> {
    try {
      if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
        await this.redis.connect().catch(() => {});
      }

      const key = `${DEDUP_PREFIX}${message.messageId}`;
      const exists = await this.redis.exists(key);
      if (exists) {
        return true;
      }

      // Store with TTL
      await this.redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS);
      return false;
    } catch (err) {
      log.error({ err: String(err), messageId: message.messageId }, 'Failed to check duplicate');
      return false; // Assume not duplicate on error
    }
  }

  /**
   * Replay a DLQ message by re-routing it to the retry exchange.
   * Increments the retry count.
   */
  async replayMessage(message: DLQMessage): Promise<void> {
    try {
      const headers: Record<string, unknown> = {
        'retry-count': message.retryCount + 1,
        'original-exchange': message.originalExchange,
        'original-routing-key': message.originalRoutingKey,
        'original-queue': message.originalQueue,
        'message-id': message.messageId,
        'replayed-at': new Date().toISOString(),
      };

      await publish(
        RETRY_EXCHANGE,
        message.originalRoutingKey,
        {
          ...(message.payload as Record<string, unknown>),
          _retry: {
            count: message.retryCount + 1,
            originalExchange: message.originalExchange,
            originalRoutingKey: message.originalRoutingKey,
            originalQueue: message.originalQueue,
            error: message.error,
            replayedAt: new Date().toISOString(),
          },
        },
      );

      log.info(
        {
          messageId: message.messageId,
          retryCount: message.retryCount + 1,
          originalQueue: message.originalQueue,
        },
        'DLQ message replayed',
      );
    } catch (err) {
      log.error(
        { err: String(err), messageId: message.messageId },
        'Failed to replay DLQ message',
      );
      throw err;
    }
  }

  /**
   * Stop the DLQ consumer.
   */
  async stop(): Promise<void> {
    this.consuming = false;
    if (this.channel) {
      try {
        await this.channel.close();
      } catch {
        // ignore
      }
      this.channel = null;
    }
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
    log.info('DLQ consumer stopped');
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global DLQ consumer instance.
 */
export const dlqConsumer = new DLQConsumer();
