import crypto from 'node:crypto';
import type { Channel } from 'amqplib';
import { rootLogger } from '../../utils/logger.js';
import { EXCHANGE_DIRECT, EXCHANGE_RETRY, QUEUE_RETRY_PREFIX, RETRY_DELAYS_MS, QUEUE_DLQ } from './exchanges.js';
import type { MessageEnvelope } from './types.js';

const log = rootLogger.child({ module: 'amqp-producer' });

export function createMessageEnvelope<T>(type: string, payload: T, source?: string): MessageEnvelope<T> {
  return {
    version: 1,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: source ?? 'stas-bot',
    type,
    payload,
  };
}

export async function publishWithConfirms(
  channel: Channel,
  exchange: string,
  routingKey: string,
  envelope: MessageEnvelope,
): Promise<boolean> {
  try {
    await channel.waitForConfirms();
  } catch {
    // not yet in confirm mode
  }

  const buffer = Buffer.from(JSON.stringify(envelope));

  const published = channel.publish(exchange, routingKey, buffer, {
    persistent: true,
    contentType: 'application/json',
    messageId: envelope.messageId,
    timestamp: Math.floor(Date.now() / 1000),
    headers: {
      'x-message-type': envelope.type,
      'x-source': envelope.source,
    },
  });

  if (!published) {
    log.warn(
      { messageId: envelope.messageId, routingKey },
      'Message not published (channel buffer full)',
    );
    return false;
  }

  log.info(
    { messageId: envelope.messageId, routingKey, type: envelope.type },
    'Message published',
  );

  return true;
}

export async function publishToPipeline(
  channel: Channel,
  payload: unknown,
  source?: string,
): Promise<boolean> {
  const envelope = createMessageEnvelope('pipeline', payload, source);
  return publishWithConfirms(channel, EXCHANGE_DIRECT, 'stas.job.pipeline', envelope);
}

export async function publishToPhase(
  channel: Channel,
  phase: string,
  payload: unknown,
  source?: string,
): Promise<boolean> {
  const envelope = createMessageEnvelope(`phase:${phase}`, payload, source);
  return publishWithConfirms(channel, EXCHANGE_DIRECT, `stas.job.phase.${phase}`, envelope);
}

export async function publishToDlq(
  channel: Channel,
  payload: unknown,
  source?: string,
): Promise<boolean> {
  const envelope = createMessageEnvelope('dlq', payload, source);
  return publishWithConfirms(channel, EXCHANGE_DIRECT, QUEUE_DLQ, envelope);
}
