/**
 * BullMQ job queue for issue processing.
 *
 * Manages the lifecycle of fix jobs — queueing, processing, retries, and cleanup.
 * Jobs are deduplicated by issue identity with a configurable TTL.
 *
 * Retry strategy uses exact delays (30s, 2min, 5min, 15min) via manual
 * re-enqueue in the worker, since BullMQ OSS only supports fixed/exponential
 * backoff. After max retries the job is copied to a dead-letter queue.
 *
 * ── Dual-write Mode ─────────────────────────────────────────────────
 * QUEUE_BACKEND env var controls whether jobs go to:
 *   bullmq   — BullMQ only (Redis, existing behavior)
 *   rabbitmq — RabbitMQ only (via producers.ts)
 *   both     — Both backends, with comparison metrics logged
 * When RabbitMQ is unavailable in "rabbitmq" mode, falls back to BullMQ.
 * ────────────────────────────────────────────────────────────────────
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis retry strategy with exponential backoff and logging
 * ✅ Worker 'failed' event logs context (jobId, repo, issueNumber, error)
 * ✅ Worker 'error' event logged for connection issues
 * ✅ Queue 'completed'/'failed' events logged
 * ✅ enqueueIssue() catches queue.add failures and returns undefined
 * ✅ Retry count and lastError persisted in job data
 * ✅ Dead-letter queue captures jobs after max retries
 * ✅ RabbitMQ publish failures logged with fallback to BullMQ
 * ✅ Sentry breadcrumbs for enqueue, retry, DLQ events
 * ────────────────────────────────────────────────────────────────────
 */

import crypto from "node:crypto";
import { Queue, Worker, QueueEvents } from "bullmq";
import { Redis } from 'ioredis';
import { config } from "../config.js";
import { runIssueAgent } from "../agent/issueAgent.js";
import type { IssueJobData } from "../utils/types.js";
import { rootLogger } from "../utils/logger.js";
import { recordQueueDepth } from "../bridge/metrics.js";
import * as messages from "../github/messages.js";
import { getOctokit } from "../github/auth.js";
import {
  bridgeMetrics,
  recordMessagePublished,
  recordMessageFailed,
  recordProcessingDuration,
} from "../bridge/metrics.js";
import { addBreadcrumb, setUserContext } from "../monitoring/sentry.js";

const log = rootLogger.child({ module: 'issue-queue' });

const QUEUE_NAME = "stas-issues";
const DLQ_NAME = "stas-issues-dlq";

// ── Per-repo concurrency lock ──────────────────────────────────────
const REPO_LOCK_KEY_PREFIX = 'concurrency:repo:';
const REPO_LOCK_TTL_S = 600; // 10 minutes — matches FIX_TIMEOUT_MS

/**
 * Redis client for repo concurrency locks (lazy, shared).
 */
let repoLockClient: Redis | null = null;

function getRepoLockClient(): Redis {
  if (!repoLockClient) {
    repoLockClient = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Repo lock Redis retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });

    repoLockClient.on('error', (err) => {
      log.error({ err: String(err) }, 'Repo lock Redis connection error');
    });
  }
  return repoLockClient;
}

/**
 * Priority mapping by billing plan.
 * Lower number = higher priority in BullMQ.
 */
function getPriorityForPlan(billingPlan?: string): number {
  switch (billingPlan) {
    case 'enterprise': return 10;
    case 'pro':         return 20;
    case 'free':
    default:            return 30;
  }
}

/**
 * Try to acquire a concurrency slot for the given repo.
 * Uses a Redis SET to track active job IDs per repo.
 * Returns true if the slot was acquired, false if the repo is at capacity.
 */
async function tryAcquireRepoSlot(
  repoOwner: string,
  repoName: string,
  jobId: string,
): Promise<boolean> {
  try {
    const client = getRepoLockClient();
    const lockKey = `${REPO_LOCK_KEY_PREFIX}${repoOwner}/${repoName}`;
    const maxConcurrency = 3;

    await client.sadd(lockKey, jobId);
    const activeCount = await client.scard(lockKey);
    await client.expire(lockKey, REPO_LOCK_TTL_S);

    if (activeCount <= maxConcurrency) {
      log.info({ repo: `${repoOwner}/${repoName}`, jobId, activeCount, limit: maxConcurrency },
        'Repo concurrency slot acquired',
      );
      return true;
    }

    // Over limit — remove our entry and block
    await client.srem(lockKey, jobId);
    log.warn({ repo: `${repoOwner}/${repoName}`, jobId, activeCount, limit: maxConcurrency },
      'Repo concurrency limit reached — slot denied',
    );
    return false;
  } catch (err) {
    log.error({ err: String(err), repo: `${repoOwner}/${repoName}`, jobId },
      'Repo concurrency acquire failed — allowing (fail-open)',
    );
    return true;
  }
}

/**
 * Release a concurrency slot for the given repo.
 */
async function releaseRepoSlot(
  repoOwner: string,
  repoName: string,
  jobId: string,
): Promise<void> {
  try {
    const client = getRepoLockClient();
    const lockKey = `${REPO_LOCK_KEY_PREFIX}${repoOwner}/${repoName}`;
    await client.srem(lockKey, jobId);
    const remaining = await client.scard(lockKey);
    if (remaining === 0) {
      await client.del(lockKey);
    }
    log.info({ repo: `${repoOwner}/${repoName}`, jobId, remaining }, 'Repo concurrency slot released');
  } catch (err) {
    log.warn({ err: String(err), repo: `${repoOwner}/${repoName}`, jobId },
      'Failed to release repo concurrency slot',
    );
  }
}

/**
 * Extended job data with retry tracking.
 */
export interface IssueJobDataWithRetry extends IssueJobData {
  retryCount?: number;
  lastError?: string;
}

/**
 * Shared Redis connection options used by BullMQ.
 */
function redisConnectionOptions() {
  return {
    url: config.queue.redisUrl || 'redis://localhost:6379',
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 3000);
      log.warn({ attempt: times }, `Redis connection retry in ${delay}ms`);
      return delay;
    },
  };
}

/**
 * Create the dead-letter queue for jobs that exceed max retries.
 */
export function createDeadLetterQueue(): Queue<IssueJobDataWithRetry, any, string, IssueJobDataWithRetry> {
  const dlq = new Queue<IssueJobDataWithRetry, any, string, IssueJobDataWithRetry>(DLQ_NAME, {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { count: config.queue.keepCompleted },
      removeOnFail: { count: config.queue.keepFailed },
    },
  });

  log.info("Dead-letter queue created");
  return dlq;
}

/**
 * Create the BullMQ issue queue.
 */
export function createIssueQueue(): Queue<IssueJobData, unknown, string, IssueJobData> {
  const queue = new Queue<IssueJobData, unknown, string, IssueJobData>(QUEUE_NAME, {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        count: config.queue.keepCompleted,
      },
      removeOnFail: {
        count: config.queue.keepFailed,
      },
    },
  });

  // Expose queue for pause/resume admin endpoints
  (queue as any).__queueName = QUEUE_NAME;

  log.info({ maxRetries: config.queue.maxRetries, retryDelays: config.queue.retryDelays }, "Issue queue created");
  return queue;
}

/**
 * Create the BullMQ worker that processes issue jobs.
 */
export function createIssueWorker(): Worker<IssueJobData> {
  const worker = new Worker<IssueJobData>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data as IssueJobDataWithRetry;
      const retryCount = data.retryCount ?? 0;

      // Set Sentry user context for error correlation
      setUserContext(data.installationId, `${data.repoOwner}/${data.repoName}`);

      log.info(
        {
          jobId: job.id,
          repo: `${data.repoOwner}/${data.repoName}`,
          issueNumber: data.issueNumber,
          attempt: retryCount + 1,
          maxRetries: config.queue.maxRetries,
        },
        'Processing issue job',
      );

      addBreadcrumb('queue', 'Processing issue job', {
        jobId: job.id,
        repo: `${data.repoOwner}/${data.repoName}`,
        issueNumber: String(data.issueNumber),
        attempt: String(retryCount + 1),
      });

      // Post retry status comment if this is a retry
      if (retryCount > 0 && data.lastError) {
        try {
          await postIssueComment(data, messages.queueRetryComment(
            retryCount + 1,
            config.queue.maxRetries,
            data.lastError,
          ));
        } catch {
          // non-fatal
        }
      }

      // Acquire per-repo concurrency slot before running
      const jobIdStr = job.id ?? crypto.randomUUID();
      const repoSlotAcquired = await tryAcquireRepoSlot(data.repoOwner, data.repoName, jobIdStr);
      if (!repoSlotAcquired) {
        log.warn(
          { jobId: job.id, repo: `${data.repoOwner}/${data.repoName}` },
          'Repo concurrency limit reached — retrying later',
        );
        throw new Error(`Repo concurrency limit reached for ${data.repoOwner}/${data.repoName}`);
      }

      // Run the agent — this is the core of STAS
      const startTime = Date.now();
      let result: import("../agent/types.js").AgentResult;
      try {
        result = await runIssueAgent(data, job.id ?? undefined);
      } catch (err) {
        // Unexpected worker-level error — schedule a retry if slots remain
        const errorMsg = String(err);
        // Save failure to persistent storage (AIM-1203)
        try {
          const { createStorage } = await import('../storage/index.js');
          const storage = await createStorage();
          if (!storage) { log.warn('Storage not available'); return; }
          await storage.saveRun({
            installationId: data.installationId,
            repoOwner: data.repoOwner,
            repoName: data.repoName,
            issueNumber: data.issueNumber,
            status: 'failed',
            error: errorMsg,
            durationMs: Date.now() - (startTime ?? Date.now()),
          });
        } catch (storageErr) {
          log.warn({ err: String(storageErr) }, 'Failed to save run failure to storage');
        }

        // Release repo slot on error
        await releaseRepoSlot(data.repoOwner, data.repoName, jobIdStr);
        if (retryCount < config.queue.maxRetries) {
          const delay = config.queue.retryDelays[retryCount] ?? 900000;
          try {
            await job.updateData({ ...data, retryCount: retryCount + 1, lastError: errorMsg } as IssueJobDataWithRetry);
          } catch {
            // non-fatal
          }
          throw err; // BullMQ will retry (attempts=1 means job fails; we handle in 'failed' event)
        }
        throw err;
      }

      if (!result.fixReady) {
        log.warn(
          { jobId: job.id, reason: result.noFixReason },
          "Fix not ready",
        );

        // Schedule a retry if slots remain
        if (retryCount < config.queue.maxRetries) {
          const delay = config.queue.retryDelays[retryCount] ?? 900000;
          try {
            await scheduleRetry(data, retryCount, result.errors?.[0] ?? result.noFixReason ?? "Fix not ready", delay);
            log.info(
              { jobId: job.id, retryCount: retryCount + 1, delayMs: delay },
              "Scheduled retry for fix-not-ready job",
            );
          } catch (err) {
            log.error({ err: String(err), jobId: job.id }, "Failed to schedule retry");
          }
        } else {
          // Max retries exhausted — move to dead-letter queue
          log.warn(
            { jobId: job.id, retryCount },
            "Max retries reached, moving to dead-letter queue",
          );
          try {
            await moveToDeadLetter(data, result.errors?.[0] ?? result.noFixReason ?? "Unknown error");
          } catch (err) {
            log.error({ err: String(err), jobId: job.id }, "Failed to move to dead-letter queue");
          }
        }
      } else {
        log.info({ jobId: job.id, confidence: result.confidence, prUrl: result.prUrl }, 'Fix completed');
        addBreadcrumb('queue', 'Job completed successfully', {
          jobId: job.id,
          repo: `${data.repoOwner}/${data.repoName}`,
          issueNumber: String(data.issueNumber),
          prUrl: result.prUrl ?? 'none',
        });
      }

      // Release per-repo concurrency slot
      await releaseRepoSlot(data.repoOwner, data.repoName, jobIdStr);

      return result;
    },
    {
      connection: redisConnectionOptions(),
      concurrency: config.queue.workerConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, repo: `${job.data.repoOwner}/${job.data.repoName}`, issueNumber: job.data.issueNumber },
      'Job completed',
    );
    recordMessagePublished('bullmq:' + QUEUE_NAME);
  });

  worker.on("failed", async (job, err) => {
    const errorMsg = String(err);
    const data = job?.data as IssueJobDataWithRetry | undefined;

    if (!job || !data) {
      log.error({ err: errorMsg }, "Job failed with no job reference");
      return;
    }

    const retryCount = data.retryCount ?? 0;

    addBreadcrumb('queue', 'Job failed', {
      jobId: job.id,
      repo: `${data.repoOwner}/${data.repoName}`,
      issueNumber: String(data.issueNumber),
      attempt: String(retryCount + 1),
      error: errorMsg,
    });

    // Update job data with retry info
    try {
      await job.updateData({
        ...data,
        retryCount,
        lastError: errorMsg,
      } as IssueJobDataWithRetry);
    } catch {
      // non-fatal
    }

    log.error(
      {
        jobId: job.id,
        repo: `${data.repoOwner}/${data.repoName}`,
        issueNumber: data.issueNumber,
        attempt: retryCount + 1,
        maxRetries: config.queue.maxRetries,
        err: errorMsg,
      },
      'Job failed',
    );
    recordMessageFailed('bullmq:' + QUEUE_NAME, 'WORKER_FAILED');

    // Schedule retry if slots remain
    if (retryCount < config.queue.maxRetries) {
      const delay = config.queue.retryDelays[retryCount] ?? 900000;
      try {
        await scheduleRetry(data, retryCount, errorMsg, delay);
        log.info(
          { jobId: job.id, retryCount: retryCount + 1, delayMs: delay },
          "Scheduled retry for failed job",
        );
      } catch (dlqErr) {
        log.error({ err: String(dlqErr), jobId: job.id }, "Failed to schedule retry");
      }
    } else {
      // Max retries — move to DLQ
      try {
        await moveToDeadLetter(data, errorMsg);
        log.info(
          { jobId: job.id, repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber },
          "Job moved to dead-letter queue",
        );
        bridgeMetrics.incrementCounter('dlq_messages_total', {
          queue: QUEUE_NAME,
          repo: data.repoOwner + '/' + data.repoName,
        });
      } catch (dlqErr) {
        log.error({ err: String(dlqErr), jobId: job.id }, "Failed to move job to dead-letter queue");
      }
    }
  });

  worker.on('error', (err) => {
    log.error({ err: String(err) }, 'Worker error');
  });

  log.info({ concurrency: config.queue.workerConcurrency }, 'Issue worker created');
  return worker;
}

/**
 * Schedule a retry by re-adding the job to the queue with a delay.
 */
async function scheduleRetry(
  data: IssueJobDataWithRetry,
  currentRetryCount: number,
  error: string,
  delayMs: number,
): Promise<void> {
  const queue = new Queue<IssueJobDataWithRetry>(QUEUE_NAME, {
    connection: { url: config.queue.redisUrl, maxRetriesPerRequest: null, enableReadyCheck: true },
  });

  try {
    await queue.add(
      "process-issue",
      {
        ...data,
        retryCount: currentRetryCount + 1,
        lastError: error,
      } as IssueJobDataWithRetry,
      { delay: delayMs },
    );
  } finally {
    await queue.close();
  }
}

/**
 * Move a job to the dead-letter queue after exhausting retries.
 */
async function moveToDeadLetter(
  data: IssueJobDataWithRetry,
  error: string,
): Promise<void> {
  const dlq = createDeadLetterQueue();
  try {
    await dlq.add(`dlq-${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`, {
      ...data,
      lastError: error,
    } as IssueJobDataWithRetry);

    // Post dead letter comment on the issue
    await postIssueComment(data, messages.deadLetterComment(error));
    log.warn(
      { repo: data.repoOwner + '/' + data.repoName, issueNumber: data.issueNumber, error },
      'DLQ alert — job moved to dead-letter queue',
    );

    addBreadcrumb('queue', 'Job moved to dead-letter queue', {
      repo: `${data.repoOwner}/${data.repoName}`,
      issueNumber: String(data.issueNumber),
      error,
    });
  } finally {
    await dlq.close();
  }
}

/**
 * Post a comment to an issue using the stored job data.
 */
async function postIssueComment(
  data: IssueJobData,
  body: string,
): Promise<void> {
  try {
    const octokit = await getOctokit(data.installationId);
    await octokit.issues.createComment({
      owner: data.repoOwner,
      repo: data.repoName,
      issue_number: data.issueNumber,
      body,
    });
  } catch (err) {
    log.warn({ err: String(err) }, "Failed to post issue comment from queue");
  }
}

/**
 * Create queue events listener for monitoring.
 */
/**
 * Pause the issue queue — stops processing new jobs.
 */
export async function pauseIssueQueue(queue: Queue<IssueJobData, unknown, string, IssueJobData>): Promise<void> {
  await queue.pause();
  log.info('Issue queue paused');
}

/**
 * Resume the issue queue — restarts processing.
 */
export async function resumeIssueQueue(queue: Queue<IssueJobData, unknown, string, IssueJobData>): Promise<void> {
  await queue.resume();
  log.info('Issue queue resumed');
}

/**
 * Check if the issue queue is paused.
 */
export async function isQueuePaused(queue: Queue<IssueJobData, unknown, string, IssueJobData>): Promise<boolean> {
  return queue.isPaused();
}

/**
 * Get queue metrics (waiting, active, completed, failed counts).
 */
export async function getQueueMetrics(queue: Queue<IssueJobData, unknown, string, IssueJobData>): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}> {
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);
  return { waiting, active, completed, failed, delayed, paused };
}

export function createQueueEvents(): QueueEvents {
  const events = new QueueEvents(QUEUE_NAME, {
    connection: redisConnectionOptions(),
  });

  events.on('completed', ({ jobId }) => {
    log.debug({ jobId }, 'Queue event: completed');
  });

  events.on('failed', ({ jobId, failedReason }) => {
    log.warn({ jobId, failedReason }, 'Queue event: failed');
  });

  return events;
}

/**
 * Update the queue depth gauge for an account by counting waiting and
 * delayed jobs in the BullMQ queue that belong to that installation.
 */
async function updateQueueDepthMetric(
  queue: Queue<IssueJobData>,
  data: IssueJobData,
): Promise<void> {
  try {
    const jobs = await queue.getJobs(['waiting', 'delayed'], 0, 1000);
    const depth = jobs.filter((j) => j.data.installationId === data.installationId).length;
    recordQueueDepth(String(data.installationId), depth);
  } catch {
    // non-fatal
  }
}

/**
 * Enqueue an issue for processing with support for dual-write mode.
 *
 * Behavior depends on QUEUE_BACKEND config:
 *   bullmq   — Publishes via BullMQ only (existing behavior, requires queue)
 *   rabbitmq — Publishes via RabbitMQ only, falls back to BullMQ on failure
 *   both     — Publishes to both backends, logs comparison metrics
 *
 * @param queue - The BullMQ queue instance (required when backend is bullmq or both)
 * @param data  - The issue job data to enqueue
 * @returns BullMQ job ID on success via BullMQ, or "rabbitmq" on RabbitMQ-only,
 *          or undefined if all backends fail.
 */
export async function enqueueIssue(
  queue: Queue<IssueJobData> | undefined,
  data: IssueJobData,
): Promise<string | undefined> {
  const repo = `${data.repoOwner}/${data.repoName}`;
  const dedupKey = `issue:${data.installationId}:${repo}#${data.issueNumber}`;
  const backend = config.queue.backend;

  addBreadcrumb('queue', 'Enqueueing issue', {
    repo,
    issueNumber: String(data.issueNumber),
    installationId: String(data.installationId),
    backend,
  });

  let rabbitmqResult: boolean | undefined;
  let bullmqResult: string | undefined;

  // ── RabbitMQ path ──────────────────────────────────────────────
  if (backend === 'rabbitmq' || backend === 'both') {
    try {
      const { publishFixJob } = await import('./producers.js');
      rabbitmqResult = await publishFixJob(data);
    } catch (err) {
      log.warn({ err: String(err), repo, issueNumber: data.issueNumber }, 'RabbitMQ publish failed');

      // In rabbitmq mode, fall back to BullMQ
      if (backend === 'rabbitmq') {
        log.info({ repo, issueNumber: data.issueNumber }, 'Falling back to BullMQ');
        // Fall through to BullMQ path below
      }
    }

    if (backend === 'rabbitmq' && rabbitmqResult === undefined) {
      // RabbitMQ failed and we're in rabbitmq-only mode — try BullMQ fallback
      // (fall through to BullMQ path)
    } else if (backend === 'rabbitmq') {
      if (rabbitmqResult) {
        log.info({ repo, issueNumber: data.issueNumber, dedupKey }, 'Issue published to RabbitMQ');
      }
      return rabbitmqResult ? 'rabbitmq' : undefined;
    }
  }

  // ── BullMQ path ────────────────────────────────────────────────
  if (backend === 'bullmq' || backend === 'both' || (backend === 'rabbitmq' && rabbitmqResult === undefined)) {
    if (!queue) {
      log.error({ repo, issueNumber: data.issueNumber }, 'BullMQ queue not available');
      return undefined;
    }

    try {
      const priority = data.priority ?? getPriorityForPlan(data.billingPlan);
      const job = await queue.add('process-issue', data, {
        priority,
        deduplication: {
          id: dedupKey,
          ttl: config.queue.dedupTtl * 1000,
        },
      });

      bullmqResult = job.id;

      log.info(
        {
          jobId: job.id,
          repo,
          issueNumber: data.issueNumber,
          dedupKey,
        },
        'Issue enqueued via BullMQ',
      );

      addBreadcrumb('queue', 'Issue enqueued via BullMQ', {
        jobId: job.id,
        repo,
        issueNumber: String(data.issueNumber),
        dedupKey,
      });
    } catch (err) {
      log.error(
        {
          err: String(err),
          repo,
          issueNumber: data.issueNumber,
          dedupKey,
        },
        'Failed to enqueue issue via BullMQ — Redis may be unreachable',
      );
      return undefined;
    }
  }

  // ── Comparison metrics for 'both' mode ─────────────────────────
  if (backend === 'both' && rabbitmqResult !== undefined && bullmqResult !== undefined) {
    log.info(
      {
        repo,
        issueNumber: data.issueNumber,
        rabbitmqPublished: rabbitmqResult,
        bullmqJobId: bullmqResult,
      },
      'Dual-write comparison — RabbitMQ and BullMQ results',
    );
  }

  return bullmqResult ?? undefined;
}
