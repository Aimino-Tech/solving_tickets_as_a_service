import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';

const log = rootLogger.child({ module: 'queue-adapter' });

export interface QueueConfig {
  name: string;
  exchange: string;
  routingKey: string;
  durable: boolean;
  ttl: number;
  dedupTtl: number;
  maxRetries: number;
  retryDelaysMs: number[];
  deadLetterExchange: string;
  deadLetterRoutingKey: string;
}

export interface EnqueueOptions {
  delay?: number;
  priority?: number;
  dedupKey?: string;
}

export interface QueueAdapter {
  enqueue(data: IssueJobData, options?: EnqueueOptions): Promise<string | undefined>;
  startConsumer(handler: (data: IssueJobData) => Promise<void>): Promise<void>;
  stopConsumer(): Promise<void>;
  getDepth(): Promise<number>;
  getBackend(): 'bullmq' | 'rabbitmq';
  isHealthy(): Promise<boolean>;
}

export async function createQueueAdapter(cfg: QueueConfig): Promise<QueueAdapter> {
  if (config.queue.backend === 'rabbitmq') {
    const { RabbitMQQueueAdapter } = await import('./rabbitmqAdapter.js');
    return new RabbitMQQueueAdapter(cfg);
  }
  const { BullMQQueueAdapter } = await import('./bullmqAdapter.js');
  return new BullMQQueueAdapter(cfg);
}
