import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rabbitmq' });

let _connection: ChannelModel | null = null;
let _channel: Channel | null = null;
let _connected = false;
let _reconnecting = false;
let _connectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;

const RABBITMQ_URL = config.queue.rabbitmqUrl || 'amqp://guest:guest@localhost:5672/stas';

export function setConnected(connected: boolean): void {
  _connected = connected;
}

export function isConnected(): boolean {
  return _connected && _channel !== null;
}

export async function ensureConnected(): Promise<boolean> {
  if (_connected) return true;
  try {
    await connect();
    return _connected;
  } catch {
    return false;
  }
}

export async function connect(): Promise<void> {
  if (_connected && _channel) return;
  if (_reconnecting) return;

  _reconnecting = true;
  _connectAttempts++;

  try {
    log.info({ url: RABBITMQ_URL.replace(/\/\/.*@/, '//***@') }, 'Connecting to RabbitMQ');
    _connection = await amqplib.connect(RABBITMQ_URL);

    _connection.on('error', (err) => {
      log.warn({ err: String(err) }, 'RabbitMQ connection error');
      _connected = false;
      scheduleReconnect();
    });

    _connection.on('close', () => {
      log.warn('RabbitMQ connection closed');
      _connected = false;
      scheduleReconnect();
    });

    _channel = await _connection.createChannel();

    _channel.on('error', (err) => {
      log.warn({ err: String(err) }, 'RabbitMQ channel error');
    });

    _channel.on('close', () => {
      log.warn('RabbitMQ channel closed');
      _channel = null;
    });

    _connected = true;
    _connectAttempts = 0;
    log.info('RabbitMQ connected successfully');
  } catch (err) {
    _connected = false;
    log.warn({ err: String(err), attempt: _connectAttempts }, 'Failed to connect to RabbitMQ');
    scheduleReconnect();
  } finally {
    _reconnecting = false;
  }
}

function scheduleReconnect(): void {
  if (_reconnecting || _connectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (_connectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.warn({ attempts: _connectAttempts }, 'Max RabbitMQ reconnection attempts reached');
    }
    return;
  }

  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (_connectAttempts - 1), 30_000);
  log.info({ delayMs: delay, attempt: _connectAttempts + 1 }, 'Scheduling RabbitMQ reconnection');

  setTimeout(() => {
    connect().catch((err) => {
      log.error({ err: String(err) }, 'Reconnection attempt failed');
    });
  }, delay);
}

export async function disconnect(): Promise<void> {
  _connected = false;
  _connectAttempts = 0;
  _reconnecting = false;

  try {
    if (_channel) {
      await _channel.close().catch(() => {});
      _channel = null;
    }
    if (_connection) {
      await _connection.close().catch(() => {});
      _connection = null;
    }
    log.info('RabbitMQ disconnected');
  } catch (err) {
    log.error({ err: String(err) }, 'Error during RabbitMQ disconnect');
  }
}

export function getChannel(): Channel {
  if (!_channel || !_connected) {
    throw new Error('RabbitMQ channel not available - call connect() first');
  }
  return _channel;
}

export function getConnection(): ChannelModel {
  if (!_connection || !_connected) {
    throw new Error('RabbitMQ connection not available - call connect() first');
  }
  return _connection;
}

export async function declareTopology(): Promise<void> {
  const ch = getChannel();

  await ch.assertExchange('stas.direct', 'direct', { durable: true });
  await ch.assertExchange('stas.topic', 'topic', { durable: true });
  await ch.assertExchange('stas.fanout', 'fanout', { durable: true });
  await ch.assertExchange('stas.dlx', 'direct', { durable: true });
  await ch.assertExchange('stas.retry', 'direct', { durable: true });

  await ch.assertQueue('stas.issues.fix', {
    durable: true,
    arguments: { 'x-message-ttl': config.queue.msgTtlMs },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'issue.fix.dlq',
    messageTtl: config.queue.msgTtlMs,
  });
  await ch.bindQueue('stas.issues.fix', 'stas.direct', 'issue.fix');

  await ch.assertQueue('stas.issues.feature', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'issue.feature.dlq',
    messageTtl: 600_000,
  });
  await ch.bindQueue('stas.issues.feature', 'stas.direct', 'issue.feature');

  await ch.assertQueue('stas.issues.research', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'issue.research.dlq',
    messageTtl: 300_000,
  });
  await ch.bindQueue('stas.issues.research', 'stas.direct', 'issue.research');

  await ch.assertQueue('stas.webhooks.notifications', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'webhook.notification.dlq',
    messageTtl: 300_000,
  });
  await ch.bindQueue('stas.webhooks.notifications', 'stas.topic', 'webhook.notification.*');

  await ch.assertQueue('stas.analytics.ingestion', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'analytics.ingestion.dlq',
    messageTtl: 120_000,
  });
  await ch.bindQueue('stas.analytics.ingestion', 'stas.topic', 'analytics.ingestion.*');

  await ch.assertQueue('stas.pipeline.events', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'pipeline.event.dlq',
    messageTtl: 60_000,
  });
  await ch.bindQueue('stas.pipeline.events', 'stas.topic', 'pipeline.event.*');

  await ch.assertQueue('stas.chat.work', {
    durable: true,
    arguments: { 'x-message-ttl': config.queue.msgTtlMs },
    deadLetterExchange: 'stas.dlx',
    deadLetterRoutingKey: 'chat.work.dlq',
    messageTtl: config.queue.msgTtlMs,
  });
  await ch.bindQueue('stas.chat.work', 'stas.direct', 'chat.work');

  await ch.assertQueue('stas.retry', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
    messageTtl: 30_000,
    deadLetterExchange: 'stas.direct',
    deadLetterRoutingKey: 'issue.fix',
  });

  await ch.assertQueue('stas.dlq', {
    durable: true,
    arguments: { 'x-message-ttl': 600000 },
  });
  await ch.bindQueue('stas.dlq', 'stas.dlx', '#');

  log.info('RabbitMQ topology declared successfully');
}

export async function publishMessage(
  exchange: string,
  routingKey: string,
  content: unknown,
  options?: amqplib.Options.Publish,
): Promise<boolean> {
  const ch = getChannel();
  const buffer = Buffer.from(JSON.stringify(content));
  const result = ch.publish(exchange, routingKey, buffer, {
    persistent: true,
    contentType: 'application/json',
    timestamp: Date.now(),
    ...options,
  });
  return result;
}

export async function consumeQueue(
  queueName: string,
  handler: (msg: ConsumeMessage) => Promise<void>,
  options?: amqplib.Options.Consume,
): Promise<string> {
  const ch = getChannel();
  try {
    await ch.checkQueue(queueName);
  } catch {
    await ch.assertQueue(queueName, { durable: true });
  }
  const consumerTag = await ch.consume(
    queueName,
    async (msg) => {
      if (!msg) return;
      try {
        await handler(msg);
        ch.ack(msg);
      } catch (err) {
        log.error({ err: String(err), queue: queueName }, 'Consumer error, nacking message');
        ch.nack(msg, false, false);
      }
    },
    { noAck: false, ...options },
  );
  log.info({ queue: queueName, consumerTag: consumerTag.consumerTag }, 'Started consuming queue');
  return consumerTag.consumerTag;
}

export async function cancelConsumer(consumerTag: string): Promise<void> {
  const ch = getChannel();
  await ch.cancel(consumerTag);
  log.info({ consumerTag }, 'Cancelled consumer');
}

export async function getQueueDepth(queueName: string): Promise<number> {
  const ch = getChannel();
  const info = await ch.checkQueue(queueName);
  return info.messageCount;
}

export interface QueueDefinition {
  name: string;
  exchange: string;
  routingKey: string;
}

export const QUEUES: Record<string, QueueDefinition> = {
  issuesFix: { name: 'stas.issues.fix', exchange: 'stas.direct', routingKey: 'issue.fix' },
  issuesFeature: { name: 'stas.issues.feature', exchange: 'stas.direct', routingKey: 'issue.feature' },
  issuesResearch: { name: 'stas.issues.research', exchange: 'stas.direct', routingKey: 'issue.research' },
  webhooks: { name: 'stas.webhooks.notifications', exchange: 'stas.topic', routingKey: 'webhook.notification.*' },
  analytics: { name: 'stas.analytics.ingestion', exchange: 'stas.topic', routingKey: 'analytics.ingestion.*' },
  pipelineEvents: { name: 'stas.pipeline.events', exchange: 'stas.topic', routingKey: 'pipeline.event.*' },
  retry: { name: 'stas.retry', exchange: 'stas.direct', routingKey: 'issue.fix' },
  dlq: { name: 'stas.dlq', exchange: 'stas.dlx', routingKey: '#' },
};

export function getPublishChannel(): Channel {
  return getChannel();
}
