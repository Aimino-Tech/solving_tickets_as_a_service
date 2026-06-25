/**
 * Emergency Stop — Queue management for hold/resume.
 *
 * Manages the hold queue where pending dispatches are redirected when
 * the kill switch is active. Provides functions to:
 *   - Move pending dispatch messages to the hold queue
 *   - Move messages from the hold queue back to the dispatch queue
 *
 * Uses the RabbitMQ management API (or direct channel operations via amqplib)
 * to inspect and move messages between queues.
 *
 * Usage:
 *   import { holdPendingMessages, resumeHeldMessages } from './emergency/queue.js';
 *   await holdPendingMessages();
 *   await resumeHeldMessages();
 */

import { connect as amqpConnect } from 'amqplib';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'emergency-queue' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * List of dispatch queues that should be paused when the kill switch is active.
 * These are the queues that agents consume from.
 */
const DISPATCH_QUEUES = [
  'stas.agents.dispatch',
  'stas.agents.verification',
  'stas.agents.sandbox',
  'stas.agents.self_audit',
  'stas.issues.triage',
  'stas.queue.pr',
  'stas.queue.notifications',
  'stas.queue.merge',
  'stas.queue.orchestrator',
  'stas.quality.enforce',
];

// ---------------------------------------------------------------------------
// RabbitMQ channel helpers
// ---------------------------------------------------------------------------

type ChannelModel = Awaited<ReturnType<typeof amqpConnect>>;

async function getChannel(): Promise<{ connection: ChannelModel; channel: Awaited<ReturnType<ChannelModel['createChannel']>> }> {
  const url = config.queue.rabbitmqUrl || 'amqp://guest:guest@localhost:5672/stas';
  const connection = await amqpConnect(url);
  const channel = await connection.createChannel();
  return { connection, channel };
}

// ---------------------------------------------------------------------------
// Hold / Resume
// ---------------------------------------------------------------------------

/**
 * Move all pending messages from dispatch queues to the hold queue.
 *
 * For each dispatch queue, this function:
 *   1. Pops messages from the dispatch queue
 *   2. Publishes them to the hold queue
 *   3. Acknowledges them on the dispatch queue
 *
 * This is a best-effort operation since true message-level moving depends
 * on unacked message states. In practice, this drains the queue of pending
 * messages and redirects them.
 */
export async function holdPendingMessages(): Promise<void> {
  const holdQueue = config.emergency.holdQueue;
  let totalMoved = 0;

  try {
    const { connection, channel } = await getChannel();

    try {
      // Assert the hold queue exists
      await channel.assertQueue(holdQueue, { durable: true });

      for (const queueName of DISPATCH_QUEUES) {
        let moved = 0;

        // Purge (get) all messages from the dispatch queue
        while (true) {
          const msg = await channel.get(queueName, { noAck: false });
          if (!msg) break; // Queue empty

          // Republish to hold queue
          channel.publish('', holdQueue, msg.content, {
            persistent: true,
            headers: {
              ...msg.properties.headers,
              'x-original-queue': queueName,
              'x-held-at': new Date().toISOString(),
              'x-emergency-reason': 'kill-switch-activated',
            },
          });

          // Acknowledge the original message
          channel.ack(msg);
          moved++;
        }

        if (moved > 0) {
          log.info({ queue: queueName, moved }, `Moved ${moved} messages from ${queueName} to hold queue`);
          totalMoved += moved;
        }
      }

      // Record metric
      if (totalMoved > 0) {
        bridgeMetrics.setGauge('stas_tasks_held', { queue: holdQueue }, totalMoved);
      }
    } finally {
      await channel.close();
      await connection.close();
    }

    log.info({ totalMoved, holdQueue }, 'Hold operation completed');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to move pending messages to hold queue');
    throw err;
  }
}

/**
 * Move all messages from the hold queue back to their original dispatch queues.
 *
 * Reads the `x-original-queue` header from held messages to determine where
 * each message should be re-dispatched. If the header is missing, the message
 * is sent to the default dispatch queue.
 */
export async function resumeHeldMessages(): Promise<void> {
  const holdQueue = config.emergency.holdQueue;
  let totalResumed = 0;

  try {
    const { connection, channel } = await getChannel();
    const defaultQueue = 'stas.agents.dispatch';

    try {
      // Assert the hold queue exists (idempotent)
      await channel.assertQueue(holdQueue, { durable: true });

      // Drain the hold queue
      while (true) {
        const msg = await channel.get(holdQueue, { noAck: false });
        if (!msg) break; // Queue empty

        // Determine the original queue from headers
        const originalQueue = (msg.properties.headers?.['x-original-queue'] as string) || defaultQueue;

        // Republish to the original queue
        const exchange = '';
        channel.publish(exchange, originalQueue, msg.content, {
          persistent: true,
          headers: {
            ...msg.properties.headers,
            'x-resumed-at': new Date().toISOString(),
          },
        });

        // Acknowledge the held message
        channel.ack(msg);
        totalResumed++;
      }

      // Clear the held tasks metric
      bridgeMetrics.setGauge('stas_tasks_held', { queue: holdQueue }, 0);
    } finally {
      await channel.close();
      await connection.close();
    }

    log.info({ totalResumed, holdQueue }, 'Resume operation completed — all held messages returned to dispatch queues');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to resume held messages from hold queue');
    throw err;
  }
}

/**
 * Get a count of currently held messages in the hold queue.
 */
export async function getHeldMessageCount(): Promise<number> {
  const holdQueue = config.emergency.holdQueue;

  try {
    const { connection, channel } = await getChannel();

    try {
      const queueInfo = await channel.assertQueue(holdQueue, { durable: true });
      return queueInfo.messageCount || 0;
    } finally {
      await channel.close();
      await connection.close();
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get held message count');
    return 0;
  }
}
