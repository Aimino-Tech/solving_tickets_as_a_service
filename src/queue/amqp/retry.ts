import type { Channel } from 'amqplib';
import { rootLogger } from '../../utils/logger.js';
import { EXCHANGE_DIRECT, EXCHANGE_RETRY, QUEUE_RETRY_PREFIX, RETRY_DELAYS_MS, QUEUE_DLQ } from './exchanges.js';
import { publishWithConfirms, createMessageEnvelope } from './producer.js';
import type { MessageEnvelope } from './types.js';

const log = rootLogger.child({ module: 'amqp-retry' });

export function getRetryQueueName(delayMs: number): string {
  return `${QUEUE_RETRY_PREFIX}${delayMs}ms`;
}

export function getNextRetryDelay(currentDelayMs: number): number | null {
  const idx = RETRY_DELAYS_MS.indexOf(currentDelayMs);
  if (idx === -1 || idx >= RETRY_DELAYS_MS.length - 1) return null;
  return RETRY_DELAYS_MS[idx + 1];
}

export function getInitialRetryDelay(): number {
  return RETRY_DELAYS_MS[0];
}

export async function scheduleRetry(
  channel: Channel,
  envelope: MessageEnvelope,
  errorMessage: string,
  retryDelayMs?: number,
): Promise<boolean> {
  const delay = retryDelayMs ?? getInitialRetryDelay();
  const retryQueueName = getRetryQueueName(delay);

  const retryEnvelope = createMessageEnvelope(
    envelope.type,
    {
      originalMessage: envelope,
      error: errorMessage,
      retryAt: new Date(Date.now() + delay).toISOString(),
    },
    envelope.source,
  );

  const published = channel.publish(EXCHANGE_RETRY, retryQueueName, Buffer.from(JSON.stringify(retryEnvelope)), {
    persistent: true,
    expiration: String(delay),
    headers: {
      'x-retry-count': (envelope as any).retryCount ?? 0,
      'x-original-type': envelope.type,
    },
  });

  if (!published) {
    log.warn(
      { messageId: envelope.messageId, delayMs: delay },
      'Failed to schedule retry',
    );
    return false;
  }

  log.info(
    { messageId: envelope.messageId, delayMs: delay, retryQueue: retryQueueName },
    'Retry scheduled',
  );

  return true;
}

export async function scheduleDlq(
  channel: Channel,
  envelope: MessageEnvelope,
  errorMessage: string,
): Promise<boolean> {
  const dlqEnvelope = createMessageEnvelope(
    'dlq',
    {
      originalMessage: envelope,
      error: errorMessage,
      failedAt: new Date().toISOString(),
    },
    envelope.source,
  );

  return publishWithConfirms(channel, EXCHANGE_DIRECT, QUEUE_DLQ, dlqEnvelope);
}
