import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import type { QueueAdapter, QueueConfig, EnqueueOptions } from './queueAdapter.js';
import {
  connect as rmqConnect,
  isConnected,
  publishMessage,
  consumeQueue,
  getQueueDepth,
  cancelConsumer,
  disconnect,
} from './rabbitmq.js';

const log = rootLogger.child({ module: 'rabbitmq-adapter' });

export class RabbitMQQueueAdapter implements QueueAdapter {
  private readonly cfg: QueueConfig;
  private consumerTag: string | null = null;

  constructor(cfg: QueueConfig) {
    this.cfg = cfg;
  }

  async enqueue(data: IssueJobData, options?: EnqueueOptions): Promise<string | undefined> {
    try {
      if (!isConnected()) {
        await rmqConnect();
      }

      const messageId = `${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}-${Date.now()}`;
      const content = {
        ...data,
        _meta: {
          messageId,
          enqueuedAt: new Date().toISOString(),
          queueName: this.cfg.name,
          delay: options?.delay,
          priority: options?.priority,
          dedupKey: options?.dedupKey,
        },
      };

      await publishMessage(this.cfg.exchange, this.cfg.routingKey, content, {
        messageId,
        expiration: options?.delay ? String(options.delay) : undefined,
        priority: options?.priority,
        headers: {
          'x-dedup-key': options?.dedupKey,
          'x-max-retries': String(this.cfg.maxRetries),
          'x-retry-delays': JSON.stringify(this.cfg.retryDelaysMs),
        },
      });

      log.info({ messageId, queue: this.cfg.name }, 'RabbitMQ enqueued message');
      return messageId;
    } catch (err) {
      log.error({ err: String(err), queue: this.cfg.name }, 'RabbitMQ enqueue failed');
      return undefined;
    }
  }

  async startConsumer(handler: (data: IssueJobData) => Promise<void>): Promise<void> {
    if (!isConnected()) {
      await rmqConnect();
    }

    this.consumerTag = await consumeQueue(this.cfg.name, async (msg) => {
      if (!msg) return;
      const content = msg.content.toString();
      let data: IssueJobData;
      try {
        data = JSON.parse(content) as IssueJobData;
      } catch {
        log.error({ content }, 'Failed to parse RabbitMQ message');
        return;
      }
      await handler(data);
    });

    log.info({ queue: this.cfg.name, consumerTag: this.consumerTag }, 'RabbitMQ consumer started');
  }

  async stopConsumer(): Promise<void> {
    if (this.consumerTag) {
      await cancelConsumer(this.consumerTag);
      this.consumerTag = null;
      log.info({ queue: this.cfg.name }, 'RabbitMQ consumer stopped');
    }
  }

  async getDepth(): Promise<number> {
    try {
      if (!isConnected()) return -1;
      return await getQueueDepth(this.cfg.name);
    } catch {
      return -1;
    }
  }

  getBackend(): 'bullmq' | 'rabbitmq' {
    return 'rabbitmq';
  }

  async isHealthy(): Promise<boolean> {
    return isConnected();
  }
}
