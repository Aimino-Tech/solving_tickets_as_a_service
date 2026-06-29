import type { Channel, ConsumeMessage } from 'amqplib';
import { rootLogger } from '../../utils/logger.js';
import { getChannel, isConnected, connect } from './connection.js';
import { publishToRetry } from './producer.js';

const log = rootLogger.child({ module: 'amqp-consumer' });

export type MessageHandler = (content: Record<string, unknown>, msg: ConsumeMessage) => Promise<void>;

interface ConsumerRegistration {
  queue: string;
  consumerTag: string;
}

const activeConsumers: Map<string, ConsumerRegistration> = new Map();

export async function consumeQueue(
  queue: string,
  handler: MessageHandler,
  options?: { prefetch?: number },
): Promise<string> {
  if (!isConnected()) {
    await connect();
  }

  const channel: Channel = getChannel();
  const tag = `consumer-${queue}-${Date.now()}`;

  if (options?.prefetch !== undefined) {
    await channel.prefetch(options.prefetch);
  }

  const consumeResult = await channel.consume(queue, async (msg) => {
    if (!msg) return;

    try {
      const content = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      await handler(content, msg);
      channel.ack(msg);
    } catch (err) {
      log.error({ err: String(err), queue, messageId: msg.properties.messageId }, 'Message processing failed');

      const retryCount = getRetryCount(msg);
      const maxRetries = 4;

      if (retryCount < maxRetries) {
        try {
          const content = JSON.parse(msg.content.toString()) as Record<string, unknown>;
          await publishToRetry(
            msg.fields.exchange,
            msg.fields.routingKey,
            content,
            retryCount + 1,
            String(err),
          );
        } catch (publishErr) {
          log.error({ err: String(publishErr) }, 'Failed to publish retry message');
        }
        channel.ack(msg);
      } else {
        channel.nack(msg, false, false);
        log.warn({ queue, messageId: msg.properties.messageId }, 'Message sent to DLQ — max retries exceeded');
      }
    }
  });

  activeConsumers.set(queue, { queue, consumerTag: consumeResult.consumerTag });
  log.info({ queue, consumerTag: consumeResult.consumerTag }, 'Consumer started');

  return consumeResult.consumerTag;
}

export async function cancelConsumer(consumerTag: string): Promise<void> {
  const channel = getChannel();
  await channel.cancel(consumerTag);

  for (const [queue, reg] of activeConsumers) {
    if (reg.consumerTag === consumerTag) {
      activeConsumers.delete(queue);
      break;
    }
  }

  log.info({ consumerTag }, 'Consumer cancelled');
}

export async function stopAllConsumers(): Promise<void> {
  const channel = getChannel();
  for (const [queue, reg] of activeConsumers) {
    try {
      await channel.cancel(reg.consumerTag);
      log.info({ queue, consumerTag: reg.consumerTag }, 'Consumer stopped');
    } catch (err) {
      log.warn({ err: String(err), queue }, 'Error stopping consumer');
    }
  }
  activeConsumers.clear();
}

function getRetryCount(msg: ConsumeMessage): number {
  const headers = msg.properties.headers;
  if (headers && headers['x-retry-count'] !== undefined) {
    return Number(headers['x-retry-count']);
  }
  return 0;
}

export function getActiveConsumerCount(): number {
  return activeConsumers.size;
}

export async function getQueueDepth(channel: Channel, queue: string): Promise<number> {
  try {
    const queueOk = await channel.checkQueue(queue);
    return queueOk.messageCount;
  } catch {
    return -1;
  }
}

export async function purgeQueue(channel: Channel, queue: string): Promise<number> {
  const result = await channel.purgeQueue(queue);
  return result.messageCount;
}
