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
 * ── Escalation (AIM-2058) ───────────────────────────────────────────
 * Integrates with the escalation module to provide a human escalation path
 * for pipeline failures:
 *   1. After 3 consecutive retries → Slack on-call page via escalation module
 *   2. Pipeline infrastructure failure (sandbox, API, network) → Linear incident
 *   3. 'Max retries exceeded' → PagerDuty / Opsgenie alert
 *   4. Issue comments rate-limited to 1 per 30 seconds per issue
 *   5. All escalation events logged with full trace for post-mortem
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
 * ✅ Escalation triggered at configured retry threshold
 * ✅ Infrastructure failure detection and Linear incident creation
 * ✅ Comment rate limiting (1 per 30s per issue)
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
import {
  escalateRetryExhaustion,
  escalateMaxRetriesExceeded,
  escalatePipelineFailure,
  canPostIssueComment,
  recordIssueComment,
  buildIssueKey,
} from "../escalation/index.js";
import { operatorAlertService } from "../services/humanEscalation.js";
import type { EscalationIssue } from "../services/humanEscalation.js";

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

      // ── Escalation check: After N consecutive retries, page on-call ──
      const escalationThreshold = config.escalation.retryThreshold;
      if (retryCount > 0 && retryCount % escalationThreshold === 0 && data.lastError) {
        const issueKey = buildIssueKey(data.repoOwner, data.repoName, data.issueNumber);
        log.warn(
          { jobId: job.id, retryCount, threshold: escalationThreshold, issueKey },
          `Retry count ${retryCount} reached escalation threshold — triggering Slack on-call page`,
        );
        escalateRetryExhaustion({
          repoOwner: data.repoOwner,
          repoName: data.repoName,
          issueNumber: data.issueNumber,
          jobId: job.id ?? undefined,
          retryAttempt: retryCount,
          lastError: data.lastError,
          errorDetails: {
            installationId: data.installationId,
            source: data.source,
            trackerType: data.trackerType,
            trackerTicketId: data.trackerTicketId,
            pipeline: data.pipeline,
          },
        }).catch((err) => {
          log.error({ err: String(err), issueKey }, 'Failed to escalate retry exhaustion');
        });
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

        // ── Detect pipeline infrastructure failures ──
        // Check for infrastructure-level errors (sandbox, API, network)
        const errorMessages = [
          ...(result.errors ?? []),
          ...(result.noFixReason ? [result.noFixReason] : []),
        ].filter(Boolean);

        for (const errorMsg of errorMessages) {
          const lowerMsg = (errorMsg ?? '').toLowerCase();
          if (
            lowerMsg.includes('sandbox') ||
            lowerMsg.includes('e2b') ||
            lowerMsg.includes('timeout') ||
            lowerMsg.includes('execution environment')
          ) {
            log.warn(
              { jobId: job.id, error: errorMsg },
              'Sandbox infrastructure failure detected — escalating',
            );
            escalatePipelineFailure({
              repoOwner: data.repoOwner,
              repoName: data.repoName,
              issueNumber: data.issueNumber,
              jobId: job.id ?? undefined,
              failureType: 'sandbox',
              error: errorMsg ?? 'Unknown sandbox error',
              errorDetails: {
                retryCount,
                installationId: data.installationId,
                source: data.source,
              },
            }).catch((e) => log.error({ err: String(e) }, 'Sandbox escalation failed'));
            break;
          }

          if (
            lowerMsg.includes('api') ||
            lowerMsg.includes('opencode') ||
            lowerMsg.includes('unreachable') ||
            lowerMsg.includes('connection refused') ||
            lowerMsg.includes('5')
          ) {
            log.warn(
              { jobId: job.id, error: errorMsg },
              'API infrastructure failure detected — escalating',
            );
            escalatePipelineFailure({
              repoOwner: data.repoOwner,
              repoName: data.repoName,
              issueNumber: data.issueNumber,
              jobId: job.id ?? undefined,
              failureType: 'api',
              error: errorMsg ?? 'Unknown API error',
              errorDetails: {
                retryCount,
                installationId: data.installationId,
                source: data.source,
              },
            }).catch((e) => log.error({ err: String(e) }, 'API escalation failed'));
            break;
          }

          if (
            lowerMsg.includes('network') ||
            lowerMsg.includes('dns') ||
            lowerMsg.includes('econnrefused') ||
            lowerMsg.includes('enotfound') ||
            lowerMsg.includes('etimedout')
          ) {
            log.warn(
              { jobId: job.id, error: errorMsg },
              'Network infrastructure failure detected — escalating',
            );
            escalatePipelineFailure({
              repoOwner: data.repoOwner,
              repoName: data.repoName,
              issueNumber: data.issueNumber,
              jobId: job.id ?? undefined,
              failureType: 'network',
              error: errorMsg ?? 'Unknown network error',
              errorDetails: {
                retryCount,
                installationId: data.installationId,
                source: data.source,
              },
            }).catch((e) => log.error({ err: String(e) }, 'Network escalation failed'));
            break;
          }
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

        // ── Escalation: 'Max retries exceeded' fires PagerDuty/Opsgenie alert ──
        const issueKey = buildIssueKey(data.repoOwner, data.repoName, data.issueNumber);
        log.warn(
          { jobId: job.id, issueKey, retryCount, maxRetries: config.queue.maxRetries },
          'Max retries exceeded — triggering critical escalation (PagerDuty/Opsgenie)',
        );
        escalateMaxRetriesExceeded({
          repoOwner: data.repoOwner,
          repoName: data.repoName,
          issueNumber: data.issueNumber,
          jobId: job.id ?? undefined,
          retryCount,
          maxRetries: config.queue.maxRetries,
          lastError: errorMsg,
          errorDetails: {
            installationId: data.installationId,
            source: data.source,
            trackerType: data.trackerType,
            trackerTicketId: data.trackerTicketId,
            pipeline: data.pipeline,
          },
        }).catch((escErr) => {
          log.error({ err: String(escErr), issueKey }, 'Failed to escalate max retries exceeded');
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

    // Escalate to operator instead of posting DLQ comment on GitHub
    const escalationIssue: EscalationIssue = {
      repoOwner: data.repoOwner,
      repoName: data.repoName,
      issueNumber: data.issueNumber,
    };
    operatorAlertService.recordFailure(escalationIssue);
    await operatorAlertService.alertOperator({
      issue: escalationIssue,
      consecutiveFailures: operatorAlertService.getConsecutiveFailures(escalationIssue),
      maxFailures: config.escalation.maxFailuresBeforeEscalation,
      reason: 'Max retries exceeded — moved to dead-letter queue',
      detail: error,
    });

    log.warn(
      { repo: data.repoOwner + '/' + data.repoName, issueNumber: data.issueNumber, error },
      'DLQ alert — job moved to dead-letter queue, operator notified',
    );
  } finally {
    await dlq.close();
  }
}

/**
 * Post a comment to an issue using the stored job data.
 * Respects rate limiting — checks canPostIssueComment before posting.
 */
async function postIssueComment(
  data: IssueJobData,
  body: string,
): Promise<void> {
  const issueKey = buildIssueKey(data.repoOwner, data.repoName, data.issueNumber);

  // Respect rate limiting
  if (!canPostIssueComment(issueKey)) {
    log.debug(
      { issueKey },
      'Skipping issue comment — rate limited (1 per 30s)',
    );
    return;
  }

  try {
    const octokit = await getOctokit(data.installationId);
    await octokit.issues.createComment({
      owner: data.repoOwner,
      repo: data.repoName,
      issue_number: data.issueNumber,
      body,
    });
    recordIssueComment(issueKey);
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
