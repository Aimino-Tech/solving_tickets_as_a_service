import type { Channel, ConsumeMessage } from 'amqplib';
import { rootLogger } from '../../utils/logger.js';
import { EXCHANGE_DIRECT, EXCHANGE_RETRY, QUEUE_RETRY_PREFIX, RETRY_DELAYS_MS, QUEUE_DLQ } from './exchanges.js';
import type { MessageEnvelope, DeliveryInfo, MessageHandler } from './types.js';

const log = rootLogger.child({ module: 'amqp-consumer' });

export interface ConsumerOptions {
  prefetch?: number;
  requeueOnError?: boolean;
  maxRetries?: number;
}

export async function startConsumer(
  channel: Channel,
  queue: string,
  handler: MessageHandler,
  options: ConsumerOptions = {},
): Promise<string> {
  const prefetch = options.prefetch ?? 10;
  const requeueOnError = options.requeueOnError ?? true;

  await channel.prefetch(prefetch);
  await channel.assertQueue(queue, { durable: true });

  const consumerTag = await channel.consume(queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    const deliveryInfo: DeliveryInfo = {
      exchange: msg.fields.exchange,
      routingKey: msg.fields.routingKey,
      redelivered: msg.fields.redelivered,
    };

    const ack = async () => {
      channel.ack(msg);
    };

    const nack = async (requeue?: boolean) => {
      channel.nack(msg, false, requeue ?? requeueOnError);
    };

    let parsed: MessageEnvelope;
    try {
      parsed = JSON.parse(msg.content.toString()) as MessageEnvelope;
    } catch (err) {
      log.warn(
        { err: String(err), routingKey: msg.fields.routingKey },
        'Failed to parse message, sending to DLQ',
      );
      channel.nack(msg, false, false);
      return;
    }

    try {
      await handler(parsed, deliveryInfo, ack, nack);
    } catch (err) {
      log.error(
        { err: String(err), messageId: parsed.messageId, routingKey: msg.fields.routingKey },
        'Message handler error',
      );
      nack(true);
    }
  });

  log.info({ queue, consumerTag: consumerTag.consumerTag }, 'Consumer started');
  return consumerTag.consumerTag;
}

export async function startDlqConsumer(
  channel: Channel,
  handler: MessageHandler,
): Promise<string> {
  return startConsumer(channel, QUEUE_DLQ, handler);
}
