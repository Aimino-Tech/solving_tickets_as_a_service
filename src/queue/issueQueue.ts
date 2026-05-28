/**
 * BullMQ job queue for issue processing.
 *
 * Manages the lifecycle of fix jobs — queueing, processing, retries, and cleanup.
 * Jobs are deduplicated by issue identity with a configurable TTL.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis retry strategy with exponential backoff and logging
 * ✅ Worker 'failed' event logs context (jobId, repo, issueNumber, error)
 * ✅ Worker 'error' event logged for connection issues
 * ✅ Queue 'completed'/'failed' events logged
 * ✅ enqueueIssue() catches queue.add failures and returns undefined
 * ────────────────────────────────────────────────────────────────────
 */

import { Queue, Worker, QueueEvents } from "bullmq";
import { config } from "../config.js";
import { runIssueAgent } from "../agent/issueAgent.js";
import type { IssueJobData } from "../utils/types.js";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "issue-queue" });

const QUEUE_NAME = "stas-issues";

/**
 * Shared Redis connection options used by BullMQ.
 * Using options-object form to avoid version conflicts between
 * the project's ioredis and BullMQ's bundled ioredis types.
 */
function redisConnectionOptions() {
  return {
    url: config.queue.redisUrl || "redis://localhost:6379",
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
 * Create the BullMQ issue queue.
 */
export function createIssueQueue(): Queue<IssueJobData, any, string, IssueJobData> {
  const queue = new Queue<IssueJobData, any, string, IssueJobData>(QUEUE_NAME, {
    connection: redisConnectionOptions(),
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        count: config.queue.keepCompleted,
      },
      removeOnFail: {
        count: config.queue.keepFailed,
      },
    },
  });

  log.info("Issue queue created");
  return queue;
}

/**
 * Create the BullMQ worker that processes issue jobs.
 */
export function createIssueWorker(): Worker<IssueJobData> {
  const worker = new Worker<IssueJobData>(
    QUEUE_NAME,
    async (job) => {
      const { data } = job;
      log.info(
        {
          jobId: job.id,
          repo: `${data.repoOwner}/${data.repoName}`,
          issueNumber: data.issueNumber,
        },
        "Processing issue job",
      );

      // Run the agent — this is the core of STAS
      const result = await runIssueAgent(data, job.id ?? undefined);

      if (!result.fixReady) {
        log.warn(
          { jobId: job.id, reason: result.noFixReason },
          "Fix not ready",
        );
      } else {
        log.info(
          { jobId: job.id, confidence: result.confidence, prUrl: result.prUrl },
          "Fix completed",
        );
      }

      // Return the result so it's stored in BullMQ job metadata
      return result;
    },
    {
      connection: redisConnectionOptions(),
      concurrency: config.queue.workerConcurrency,
    },
  );

  worker.on("completed", (job) => {
    log.info(
      { jobId: job.id, repo: `${job.data.repoOwner}/${job.data.repoName}`, issueNumber: job.data.issueNumber },
      "Job completed",
    );
  });

  worker.on("failed", (job, err) => {
    log.error(
      {
        jobId: job?.id,
        repo: job ? `${job.data.repoOwner}/${job.data.repoName}` : "unknown",
        issueNumber: job?.data.issueNumber,
        err: String(err),
      },
      "Job failed",
    );
  });

  worker.on("error", (err) => {
    log.error({ err: String(err) }, "Worker error");
  });

  log.info({ concurrency: config.queue.workerConcurrency }, "Issue worker created");
  return worker;
}

/**
 * Create queue events listener for monitoring.
 */
export function createQueueEvents(): QueueEvents {
  const events = new QueueEvents(QUEUE_NAME, {
    connection: redisConnectionOptions(),
  });

  events.on("completed", ({ jobId }) => {
    log.debug({ jobId }, "Queue event: completed");
  });

  events.on("failed", ({ jobId, failedReason }) => {
    log.warn({ jobId, failedReason }, "Queue event: failed");
  });

  return events;
}

/**
 * Enqueue an issue for processing with deduplication.
 */
export async function enqueueIssue(
  queue: Queue<IssueJobData>,
  data: IssueJobData,
): Promise<string | undefined> {
  const dedupKey = `issue:${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`;

  try {
    const job = await queue.add(
      "process-issue",
      data,
      {
        deduplication: {
          id: dedupKey,
          ttl: config.queue.dedupTtl * 1000,
        },
      },
    );

    log.info(
      {
        jobId: job.id,
        repo: `${data.repoOwner}/${data.repoName}`,
        issueNumber: data.issueNumber,
        dedupKey,
      },
      "Issue enqueued",
    );

    return job.id;
  } catch (err) {
    log.error(
      {
        err: String(err),
        repo: `${data.repoOwner}/${data.repoName}`,
        issueNumber: data.issueNumber,
        dedupKey,
      },
      "Failed to enqueue issue — Redis may be unreachable",
    );
    return undefined;
  }
}
