import { Queue, Worker } from 'bullmq';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import type { QueueAdapter, QueueConfig, EnqueueOptions } from './queueAdapter.js';

const log = rootLogger.child({ module: 'bullmq-adapter' });

function redisConnection() {
  return {
    url: config.queue.redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

export class BullMQQueueAdapter implements QueueAdapter {
  private queue: Queue<IssueJobData>;
  private worker: Worker<IssueJobData> | null = null;
  private readonly cfg: QueueConfig;

  constructor(cfg: QueueConfig) {
    this.cfg = cfg;
    this.queue = new Queue<IssueJobData>(cfg.name, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: config.queue.keepCompleted },
        removeOnFail: { count: config.queue.keepFailed },
      },
    });
    log.info({ queueName: cfg.name }, 'BullMQ queue adapter created');
  }

  async enqueue(data: IssueJobData, options?: EnqueueOptions): Promise<string | undefined> {
    try {
      const job = await this.queue.add('process-issue', data, {
        delay: options?.delay,
        priority: options?.priority,
        deduplication: options?.dedupKey
          ? { id: options.dedupKey, ttl: this.cfg.dedupTtl * 1000 }
          : undefined,
      });
      log.info({ jobId: job.id, queue: this.cfg.name }, 'BullMQ enqueued job');
      return job.id;
    } catch (err) {
      log.error({ err: String(err), queue: this.cfg.name }, 'BullMQ enqueue failed');
      return undefined;
    }
  }

  async startConsumer(handler: (data: IssueJobData) => Promise<void>): Promise<void> {
    this.worker = new Worker<IssueJobData>(
      this.cfg.name,
      async (job) => {
        await handler(job.data);
      },
      {
        connection: redisConnection(),
        concurrency: config.queue.workerConcurrency,
      },
    );

    this.worker.on('failed', (job, err) => {
      log.error({ jobId: job?.id, err: String(err), queue: this.cfg.name }, 'BullMQ job failed');
    });

    this.worker.on('error', (err) => {
      log.error({ err: String(err), queue: this.cfg.name }, 'BullMQ worker error');
    });

    log.info({ queue: this.cfg.name, concurrency: config.queue.workerConcurrency }, 'BullMQ consumer started');
  }

  async stopConsumer(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      log.info({ queue: this.cfg.name }, 'BullMQ consumer stopped');
    }
  }

  async getDepth(): Promise<number> {
    try {
      const counts = await this.queue.getJobCounts('wait', 'active', 'delayed', 'paused');
      return (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.paused ?? 0);
    } catch {
      return -1;
    }
  }

  getBackend(): 'bullmq' | 'rabbitmq' {
    return 'bullmq';
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.queue.getJobCounts();
      return true;
    } catch {
      return false;
    }
  }
}
