import { rootLogger } from '../../utils/logger.js';
import { getChannel } from './connection.js';
import { declareTopology } from './exchanges.js';

const log = rootLogger.child({ module: 'amqp-retry' });

export interface RetryConfig {
  maxRetries: number;
  delaysMs: number[];
  deadLetterExchange: string;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 4,
  delaysMs: [30_000, 120_000, 300_000, 900_000],
  deadLetterExchange: 'syntaro.dlx',
};

export function getDelayForRetry(retryCount: number): number {
  const delays = DEFAULT_RETRY_CONFIG.delaysMs;
  return delays[Math.min(retryCount, delays.length - 1)] ?? delays[delays.length - 1];
}

export function getRetryQueueName(retryCount: number): string {
  const names = ['syntaro.retry.30s', 'syntaro.retry.2m', 'syntaro.retry.5m', 'syntaro.retry.15m'];
  return names[Math.min(retryCount, names.length - 1)] ?? names[names.length - 1];
}

export async function setupRetryInfrastructure(): Promise<void> {
  const channel = getChannel();
  await declareTopology(channel);

  log.info('Retry infrastructure (DLX + retry queues) declared');
}

export function shouldRetry(retryCount: number, config?: RetryConfig): boolean {
  const cfg = config ?? DEFAULT_RETRY_CONFIG;
  return retryCount < cfg.maxRetries;
}
