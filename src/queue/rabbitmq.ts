import { connect as amqpConnect, type Channel, type Connection, type ChannelModel } from 'amqplib';
import fs from 'node:fs';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rabbitmq' });

export const EXCHANGES = {
  issues: { name: 'stas.issues', type: 'topic' },
  agents: { name: 'stas.agents', type: 'direct' },
  events: { name: 'stas.events', type: 'topic' },
  dlx: { name: 'stas.dlx', type: 'direct' },
} as const;

export const QUEUES = {
  issuesFix: { name: 'stas.issues.fix', exchange: 'stas.issues', routingKey: 'fix' },
  triage: { name: 'stas.agents.triage', exchange: 'stas.agents', routingKey: 'triage' },
  opencode: { name: 'stas.agents.opencode', exchange: 'stas.agents', routingKey: 'opencode' },
  sandbox: { name: 'stas.agents.sandbox', exchange: 'stas.agents', routingKey: 'sandbox' },
  verification: { name: 'stas.agents.verification', exchange: 'stas.agents', routingKey: 'verification' },
  notifications: { name: 'stas.events.notifications', exchange: 'stas.events', routingKey: 'notifications' },
  audit: { name: 'stas.events.audit', exchange: 'stas.events', routingKey: 'audit' },
} as const;

interface RabbitMQState {
  connection: Connection | null;
  publishChannel: Channel | null;
  consumeChannel: Channel | null;
  reconnectAttempts: number;
  shutdownInitiated: boolean;
}

const state: RabbitMQState = {
  connection: null,
  publishChannel: null,
  consumeChannel: null,
  reconnectAttempts: 0,
  shutdownInitiated: false,
};

function getUrl(): string {
  return config.rabbitmq.url;
}

/**
 * Build TLS socket options for amqps:// connections.
 *
 * Reads certificate files from paths specified in config. Returns undefined
 * when no TLS paths are configured (plain amqp:// connections).
 */
function buildTlsOptions(): Record<string, unknown> | undefined {
  const { tls } = config.rabbitmq;

  if (!tls.certPath && !tls.keyPath && !tls.caPath) {
    return undefined;
  }

  const opts: Record<string, unknown> = {};

  if (tls.certPath) {
    try {
      opts.cert = fs.readFileSync(tls.certPath);
    } catch (err) {
      log.error({ err: String(err), path: tls.certPath }, 'Failed to read RabbitMQ TLS certificate');
      throw err;
    }
  }

  if (tls.keyPath) {
    try {
      opts.key = fs.readFileSync(tls.keyPath);
    } catch (err) {
      log.error({ err: String(err), path: tls.keyPath }, 'Failed to read RabbitMQ TLS key');
      throw err;
    }
  }

  if (tls.caPath) {
    try {
      opts.ca = [fs.readFileSync(tls.caPath)];
    } catch (err) {
      log.error({ err: String(err), path: tls.caPath }, 'Failed to read RabbitMQ TLS CA certificate');
      throw err;
    }
  }

  if (tls.servername) {
    opts.servername = tls.servername;
  }

  opts.rejectUnauthorized = tls.rejectUnauthorized;

  return opts;
}

async function declareTopology(channel: Channel): Promise<void> {
  for (const ex of Object.values(EXCHANGES)) {
    await channel.assertExchange(ex.name, ex.type, { durable: true });
  }

  await channel.assertExchange('stas.dlx', 'direct', { durable: true });

  for (const q of Object.values(QUEUES)) {
    const dlqName = `${q.name}.dlq`;
    await channel.assertQueue(q.name, {
      durable: true,
      deadLetterExchange: 'stas.dlx',
      deadLetterRoutingKey: q.name,
    });
    await channel.assertQueue(dlqName, { durable: true });
    await channel.bindQueue(q.name, q.exchange, q.routingKey);
    await channel.bindQueue(dlqName, 'stas.dlx', q.name);
  }

  log.info('RabbitMQ topology declared — exchanges=%d queues=%d', Object.keys(EXCHANGES).length, Object.keys(QUEUES).length);
}

export async function connect(options?: {
  url?: string;
}): Promise<void> {
  if (state.connection) return;
  if (state.shutdownInitiated) return;

  const url = options?.url ?? getUrl();

  const tlsOptions = buildTlsOptions();
  const useTls = url.startsWith('amqps://') && tlsOptions !== undefined;

  try {
    const connection = useTls
      ? await amqpConnect(url, tlsOptions)
      : await amqpConnect(url);
    state.connection = connection;

    connection.on('error', (err) => {
      log.error({ err: String(err) }, 'RabbitMQ connection error');
      scheduleReconnect();
    });

    connection.on('close', () => {
      log.warn('RabbitMQ connection closed');
      state.connection = null;
      state.publishChannel = null;
      state.consumeChannel = null;
      if (!state.shutdownInitiated) {
        scheduleReconnect();
      }
    });

    const publishChannel = await connection.createChannel();
    await publishChannel.prefetch(config.rabbitmq.prefetchCount);
    state.publishChannel = publishChannel;

    const consumeChannel = await connection.createChannel();
    await consumeChannel.prefetch(config.rabbitmq.prefetchCount);
    state.consumeChannel = consumeChannel;

    await declareTopology(publishChannel);

    state.reconnectAttempts = 0;
    const redactedUrl = url.replace(/\/\/.*@/, '//***@');
    log.info('RabbitMQ connected — url=%s tls=%s', redactedUrl, useTls);
  } catch (err) {
    log.error({ err: String(err) }, 'RabbitMQ connection failed');
    scheduleReconnect();
    throw err;
  }
}

function scheduleReconnect(): void {
  if (state.shutdownInitiated) return;
  if (state.reconnectAttempts >= config.rabbitmq.maxReconnectAttempts) {
    log.error(
      { attempts: state.reconnectAttempts, max: config.rabbitmq.maxReconnectAttempts },
      'RabbitMQ max reconnection attempts reached',
    );
    return;
  }

  state.reconnectAttempts++;
  const delay = Math.min(
    config.rabbitmq.reconnectDelayMs * Math.pow(2, state.reconnectAttempts - 1),
    60000,
  );

  log.info(
    { attempt: state.reconnectAttempts, delayMs: delay },
    'Scheduling RabbitMQ reconnection',
  );

  setTimeout(() => {
    connect().catch((err) => {
      log.error({ err: String(err) }, 'RabbitMQ reconnection failed');
    });
  }, delay);
}

export function getPublishChannel(): Channel {
  if (!state.publishChannel) {
    throw new Error('RabbitMQ publish channel not available — call connect() first');
  }
  return state.publishChannel;
}

export function getConsumeChannel(): Channel {
  if (!state.consumeChannel) {
    throw new Error('RabbitMQ consume channel not available — call connect() first');
  }
  return state.consumeChannel;
}

/**
 * Extended publish options that include headers for retry tracking.
 */
export interface PublishOptions {
  persistent?: boolean;
  expiration?: string;
  headers?: Record<string, string>;
}

export async function publish(
  exchange: string,
  routingKey: string,
  content: object,
  options?: PublishOptions,
): Promise<boolean> {
  const channel = getPublishChannel();
  const buffer = Buffer.from(JSON.stringify(content));

  const published = channel.publish(exchange, routingKey, buffer, {
    persistent: options?.persistent ?? true,
    expiration: options?.expiration,
    headers: options?.headers,
    contentType: 'application/json',
    timestamp: Math.floor(Date.now() / 1000),
  });

  if (!published) {
    log.warn({ exchange, routingKey }, 'RabbitMQ publish returned false — channel may be full');
  }

  return published;
}

export async function gracefulShutdown(): Promise<void> {
  state.shutdownInitiated = true;

  try {
    if (state.publishChannel) {
      await state.publishChannel.close();
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Error closing publish channel');
  }

  try {
    if (state.consumeChannel) {
      await state.consumeChannel.close();
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Error closing consume channel');
  }

  try {
    if (state.connection) {
      await state.connection.close();
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Error closing connection');
  }

  state.connection = null;
  state.publishChannel = null;
  state.consumeChannel = null;

  log.info('RabbitMQ shutdown complete');
}

export function isConnected(): boolean {
  return state.connection !== null && state.publishChannel !== null;
}
