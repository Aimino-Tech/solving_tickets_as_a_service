import { connect as amqpConnect, type Channel, type ChannelModel } from 'amqplib';
import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'amqp-connection' });

interface AmqpState {
  connection: ChannelModel | null;
  channel: Channel | null;
  reconnectAttempts: number;
  shutdownInitiated: boolean;
}

const state: AmqpState = {
  connection: null,
  channel: null,
  reconnectAttempts: 0,
  shutdownInitiated: false,
};

function getUrl(): string {
  return config.rabbitmq.url;
}

export async function connect(options?: { url?: string }): Promise<Channel> {
  if (state.channel) return state.channel;
  if (state.shutdownInitiated) throw new Error('Shutdown initiated');

  const url = options?.url ?? getUrl();

  try {
    const connection = await amqpConnect(url);
    state.connection = connection;

    connection.on('error', (err) => {
      log.error({ err: String(err) }, 'AMQP connection error');
      scheduleReconnect();
    });

    connection.on('close', () => {
      log.warn('AMQP connection closed');
      state.connection = null;
      state.channel = null;
      if (!state.shutdownInitiated) {
        scheduleReconnect();
      }
    });

    const channel = await connection.createChannel();
    await channel.prefetch(config.rabbitmq.prefetchCount);
    state.channel = channel;

    state.reconnectAttempts = 0;
    const redactedUrl = url.replace(/\/\/.*@/, '//***@');
    log.info({ url: redactedUrl }, 'AMQP connected');

    return channel;
  } catch (err) {
    log.error({ err: String(err) }, 'AMQP connection failed');
    scheduleReconnect();
    throw err;
  }
}

function scheduleReconnect(): void {
  if (state.shutdownInitiated) return;
  if (state.reconnectAttempts >= config.rabbitmq.maxReconnectAttempts) {
    log.error(
      { attempts: state.reconnectAttempts, max: config.rabbitmq.maxReconnectAttempts },
      'AMQP max reconnection attempts reached',
    );
    return;
  }

  state.reconnectAttempts++;
  const delay = Math.min(
    config.rabbitmq.reconnectDelayMs * Math.pow(2, state.reconnectAttempts - 1),
    60000,
  );

  log.info({ attempt: state.reconnectAttempts, delayMs: delay }, 'Scheduling AMQP reconnection');

  setTimeout(() => {
    connect().catch((err) => {
      log.error({ err: String(err) }, 'AMQP reconnection failed');
    });
  }, delay);
}

export async function gracefulShutdown(): Promise<void> {
  state.shutdownInitiated = true;

  try {
    if (state.channel) {
      await state.channel.close();
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Error closing AMQP channel');
  }

  try {
    if (state.connection) {
      await state.connection.close();
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Error closing AMQP connection');
  }

  state.connection = null;
  state.channel = null;
  log.info('AMQP shutdown complete');
}

export function getChannel(): Channel {
  if (!state.channel) {
    throw new Error('AMQP channel not available — call connect() first');
  }
  return state.channel;
}

export function isConnected(): boolean {
  return state.connection !== null && state.channel !== null;
}
