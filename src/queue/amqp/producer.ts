import crypto from 'node:crypto';
import { rootLogger } from '../../utils/logger.js';
import { getChannel, isConnected, connect } from './connection.js';

const log = rootLogger.child({ module: 'amqp-producer' });

export interface PublishOptions {
  persistent?: boolean;
  expiration?: string;
  priority?: number;
  headers?: Record<string, string | number | undefined>;
  correlationId?: string;
  replyTo?: string;
}

export async function publishMessage(
  exchange: string,
  routingKey: string,
  content: Record<string, unknown>,
  options?: PublishOptions,
): Promise<boolean> {
  if (!isConnected()) {
    await connect();
  }

  const channel = getChannel();
  const buffer = Buffer.from(JSON.stringify(content));

  const published = channel.publish(exchange, routingKey, buffer, {
    persistent: options?.persistent ?? true,
    expiration: options?.expiration,
    priority: options?.priority,
    headers: options?.headers as Record<string, string> | undefined,
    contentType: 'application/json',
    timestamp: Math.floor(Date.now() / 1000),
    correlationId: options?.correlationId,
    replyTo: options?.replyTo,
    messageId: crypto.randomUUID(),
  });

  if (!published) {
    log.warn({ exchange, routingKey }, 'Publish returned false — channel may be full');
  }

  return published;
}

export async function publishJob(
  payload: Record<string, unknown>,
  exchange = 'stas.direct',
  routingKey = 'stas.job.pipeline',
): Promise<boolean> {
  const messageId = crypto.randomUUID();
  const content = {
    version: 1,
    messageId,
    timestamp: new Date().toISOString(),
    source: 'stas-bot',
    type: 'job',
    payload,
    _meta: {
      messageId,
      enqueuedAt: new Date().toISOString(),
    },
  };

  return publishMessage(exchange, routingKey, content);
}

export async function publishPhase(
  jobId: string,
  phase: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const routingKey = `stas.job.phase.${phase}`;
  return publishMessage('stas.direct', routingKey, {
    version: 1,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'stas-bot',
    type: 'phase',
    payload: { ...payload, jobId, phase },
    _meta: { jobId, phase },
  });
}

export async function publishToRetry(
  originalExchange: string,
  originalRoutingKey: string,
  content: Record<string, unknown>,
  retryCount: number,
  error: string,
): Promise<boolean> {
  const delays = [30_000, 120_000, 300_000, 900_000];
  const delayIndex = Math.min(retryCount, delays.length - 1);
  const retryQueue = ['stas.retry.30s', 'stas.retry.2m', 'stas.retry.5m', 'stas.retry.15m'][delayIndex];

  const envelope = {
    originalExchange,
    originalRoutingKey,
    envelope: content,
    retryCount,
    error,
  };

  return publishMessage('stas.retry', retryQueue, envelope, {
    expiration: String(delays[delayIndex]),
    headers: { 'x-retry-count': String(retryCount) },
  });
}
