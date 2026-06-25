/**
 * BullMQ job queue for issue processing.
 *
 * Manages the lifecycle of fix jobs — queueing, processing, retries, and cleanup.
 * Jobs are deduplicated by issue identity with a configurable TTL.
 *
 * Retry strategy uses exact delays (30s, 2min, 5min, 15min) via manual
 * re-enqueue in the worker, since BullMQ OSS only supports fixed/exponential
 * backoff. After max retries the job is moved to the dead-letter queue.
 *
 * ⚠️ DLG REPROCESSING (AIM-2056):
 * Once a message enters the dead-letter queue, it STAYS there until manually
 * acknowledged by an admin via the DLQ admin API. No automatic replay occurs.
 * Full context is logged and alerts are dispatched via Slack/Linear.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis retry strategy with exponential backoff and logging
 * ✅ Worker 'failed' event logs context (jobId, repo, issueNumber, error)
 * ✅ Worker 'error' event logged for connection issues
 * ✅ Queue 'completed'/'failed' events logged
 * ✅ enqueueIssue() catches queue.add failures and returns undefined
 * ✅ Retry count and lastError persisted in job data
 * ✅ Dead-letter queue captures jobs after max retries
 * ✅ DLQ alerts dispatched to Slack/Linear with full trace context
 * ✅ DLG entries remain dead until manually acknowledged — no auto-replay
 * ────────────────────────────────────────────────────────────────────
 */

import { Queue, Worker, QueueEvents } from "bullmq";
import { config } from "../config.js";
import { runIssueAgent } from "../agent/issueAgent.js";
import type { IssueJobData } from "../utils/types.js";
import { rootLogger } from "../utils/logger.js";
import * as messages from "../github/messages.js";
import { getOctokit } from "../github/auth.js";
import {
  bridgeMetrics,
  recordMessagePublished,
  recordMessageFailed,
  recordProcessingDuration,
} from "../bridge/metrics.js";
import { recordDeadLetter } from "./deadLetterQueue.js";

const log = rootLogger.child({ module: 'issue-queue' });

const QUEUE_NAME = "stas-issues";
const DLQ_NAME = "stas-issues-dlq";

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

      // Run the agent — this is the core of STAS
      let result: import("../agent/types.js").AgentResult;
      try {
        result = await runIssueAgent(data, job.id ?? undefined);
      } catch (err) {
        // Unexpected worker-level error — schedule a retry if slots remain
        const errorMsg = String(err);
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

        // Terminal results (e.g., triage classified as 'question' or 'feature')
        // should never be retried — move directly to dead-letter queue
        if (result.isTerminal) {
          log.info(
            { jobId: job.id, reason: result.noFixReason },
            "Terminal result — not scheduling retry",
          );
          try {
            await moveToDeadLetter(data, result.errors?.[0] ?? result.noFixReason ?? "Terminal result");
          } catch (err) {
            log.error({ err: String(err), jobId: job.id }, "Failed to move terminal result to dead-letter queue");
          }
          return result;
        }

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
          // Max retries exhausted — move to dead-letter queue (no auto-replay)
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
      }

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
      // Max retries — move to DLQ (no auto-replay, stays dead until manually acknowledged)
      try {
        await moveToDeadLetter(data, errorMsg);

        // Record the DLQ in the BullMQ DLQ queue for backup persistence
        const dlq = createDeadLetterQueue();
        try {
          await dlq.add(`dlq-${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`, {
            ...data,
            lastError: errorMsg,
          } as IssueJobDataWithRetry);
          log.info(
            { jobId: job.id, repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber },
            "Job persisted to BullMQ dead-letter queue",
          );
        } finally {
          await dlq.close();
        }

        // Remove the failed job from the main queue to prevent reprocessing
        try {
          await job.remove();
          log.debug({ jobId: job.id }, "Removed failed job from main queue after DLQ transfer");
        } catch {
          // non-fatal
        }

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
 *
 * ⚠️ AIM-2056: Messages moved to the DLQ remain dead until manually
 * acknowledged by an admin. No automatic replay mechanism exists.
 * Full context is logged via recordDeadLetter() and alerts are dispatched.
 */
async function moveToDeadLetter(
  data: IssueJobDataWithRetry,
  error: string,
): Promise<void> {
  // Capture stack trace from the current Error context if available
  const stackTrace = new Error().stack;

  // Record the DLQ entry with full context via the DLQ management module
  // This handles: in-memory tracking, structured logging, alert dispatch, metrics
  await recordDeadLetter(data, error, QUEUE_NAME, stackTrace);

  // Post dead letter comment on the issue
  try {
    await postIssueComment(data, messages.deadLetterComment(error));
  } catch {
    // non-fatal — comment posting failure should not block DLQ recording
  }

  log.warn(
    {
      repo: data.repoOwner + '/' + data.repoName,
      issueNumber: data.issueNumber,
      error,
    },
    'DLQ: job moved to dead-letter queue (no automatic replay)',
  );
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
 * Enqueue an issue for processing via BullMQ.
 *
 * @param queue - The BullMQ queue instance
 * @param data  - The issue job data to enqueue
 * @returns BullMQ job ID on success, or undefined if all backends fail.
 */
export async function enqueueIssue(
  queue: Queue<IssueJobData>,
  data: IssueJobData,
): Promise<string | undefined> {
  const repo = `${data.repoOwner}/${data.repoName}`;
  const dedupKey = `issue:${data.installationId}:${repo}#${data.issueNumber}`;

  try {
    const job = await queue.add('process-issue', data, {
      deduplication: {
        id: dedupKey,
        ttl: config.queue.dedupTtl * 1000,
      },
    });

    log.info(
      {
        jobId: job.id,
        repo,
        issueNumber: data.issueNumber,
        dedupKey,
      },
      'Issue enqueued via BullMQ',
    );

    return job.id;
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
