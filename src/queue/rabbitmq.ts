import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rabbitmq' });

let _connected = false;

export function setConnected(connected: boolean): void {
  _connected = connected;
}

export function isConnected(): boolean {
  return _connected;
}

export async function connect(): Promise<void> {
  _connected = false;
  log.info('RabbitMQ stub: connect() called (OSS mode — no-op)');
}

export async function disconnect(): Promise<void> {
  _connected = false;
  log.info('RabbitMQ stub: disconnect() called');
}
