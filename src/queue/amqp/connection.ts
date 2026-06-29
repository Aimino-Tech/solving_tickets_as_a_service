import { connect, type Connection, type Channel, type Options } from 'amqplib';
import { rootLogger } from '../../utils/logger.js';
import type { AmqpConfig } from './types.js';

const log = rootLogger.child({ module: 'amqp-connection' });

export class AmqpConnection {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private config: AmqpConfig;
  private reconnectAttempts = 0;
  private isClosing = false;

  constructor(config: AmqpConfig) {
    this.config = config;
  }

  async connect(): Promise<Channel> {
    if (this.channel && this.channel.connection) {
      try {
        await this.channel.checkQueue('__amqp_health_check__');
        return this.channel;
      } catch {
        log.warn('Channel is stale, reconnecting...');
      }
    }

    this.isClosing = false;
    const conn = await connect(this.config.url, {
      heartbeat: this.config.heartbeat,
    });

    this.connection = conn;

    conn.on('error', (err) => {
      log.error({ err: String(err) }, 'AMQP connection error');
    });

    conn.on('close', () => {
      log.warn('AMQP connection closed');
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });

    const ch = await conn.createChannel();
    ch.on('error', (err) => {
      log.error({ err: String(err) }, 'AMQP channel error');
    });

    ch.on('close', () => {
      log.warn('AMQP channel closed');
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });

    await ch.prefetch(this.config.prefetch);
    this.channel = ch;
    this.reconnectAttempts = 0;

    log.info('AMQP connection established');
    return ch;
  }

  async getChannel(): Promise<Channel> {
    if (!this.channel || !this.connection) {
      return this.connect();
    }
    return this.channel;
  }

  async close(): Promise<void> {
    this.isClosing = true;
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing AMQP connection');
    }
    this.channel = null;
    this.connection = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      log.error({ attempts: this.reconnectAttempts }, 'Max AMQP reconnect attempts reached');
      return;
    }

    const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    log.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'Scheduling AMQP reconnection');

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        log.error({ err: String(err), attempt: this.reconnectAttempts }, 'AMQP reconnection failed');
        this.scheduleReconnect();
      }
    }, delay);
  }
}
