import type { Channel } from 'amqplib';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'amqp-exchanges' });

export const EXCHANGE_DIRECT = 'stas.direct';
export const EXCHANGE_RETRY = 'stas.retry';
export const EXCHANGE_DLQ = 'stas.dlq';
export const EXCHANGE_PHASE = 'stas.phase';

export const QUEUE_PIPELINE = 'stas.job.pipeline';
export const QUEUE_DLQ = 'stas.job.dlq';
export const QUEUE_PHASE_PREFIX = 'stas.job.phase.';
export const QUEUE_RETRY_PREFIX = 'stas.retry.';

export const RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 900_000];

export async function declareExchanges(channel: Channel): Promise<void> {
  // Main direct exchange for job routing
  await channel.assertExchange(EXCHANGE_DIRECT, 'direct', {
    durable: true,
    autoDelete: false,
  });

  // Retry exchange (DLX) with delayed retry queues
  await channel.assertExchange(EXCHANGE_RETRY, 'direct', {
    durable: true,
    autoDelete: false,
  });

  // Dead letter exchange
  await channel.assertExchange(EXCHANGE_DLQ, 'direct', {
    durable: true,
    autoDelete: false,
  });

  // Phase result exchange
  await channel.assertExchange(EXCHANGE_PHASE, 'topic', {
    durable: true,
    autoDelete: false,
  });

  log.info('AMQP exchanges declared');
}

export async function declareRetryQueues(channel: Channel): Promise<void> {
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    const delay = RETRY_DELAYS_MS[i];
    const retryQueueName = `${QUEUE_RETRY_PREFIX}${delay}ms`;
    const isLast = i === RETRY_DELAYS_MS.length - 1;
    const nextRetryQueue = isLast ? QUEUE_DLQ : `${QUEUE_RETRY_PREFIX}${RETRY_DELAYS_MS[i + 1]}ms`;

    // Retry queue that waits for the delay and then routes to the next retry or DLQ
    await channel.assertQueue(retryQueueName, {
      durable: true,
      deadLetterExchange: EXCHANGE_DIRECT,
      deadLetterRoutingKey: isLast ? QUEUE_DLQ : nextRetryQueue,
      messageTtl: delay,
      autoDelete: false,
    });

    // Bind retry queue to retry exchange
    await channel.bindQueue(retryQueueName, EXCHANGE_RETRY, retryQueueName);
  }

  log.info('AMQP retry queues declared');
}

export async function declareDlq(channel: Channel): Promise<void> {
  await channel.assertQueue(QUEUE_DLQ, {
    durable: true,
    autoDelete: false,
  });

  await channel.bindQueue(QUEUE_DLQ, EXCHANGE_DLQ, QUEUE_DLQ);
  log.info('AMQP DLQ declared');
}
