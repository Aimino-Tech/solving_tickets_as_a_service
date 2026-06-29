import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { getChannel, publishMessage, consumeQueue, cancelConsumer } from './rabbitmq.js';
import { runIssueAgent } from '../agent/issueAgent.js';
import type { IssueJobData } from '../utils/types.js';
import * as messages from '../github/messages.js';
import { getOctokit } from '../github/auth.js';
import {
  bridgeMetrics,
} from '../bridge/metrics.js';
import { acquireRepoLock, releaseRepoLock } from './repoLock.js';

const log = rootLogger.child({ module: 'rabbitmq-issue-queue' });

const ISSUE_EXCHANGE = 'stas.direct';
const ISSUE_QUEUE = 'stas.issues.fix';
const ISSUE_ROUTING_KEY = 'issue.fix';
const RETRY_EXCHANGE = 'stas.retry';
const RETRY_QUEUE = 'stas.retry';
const DLQ_QUEUE = 'stas.dlq';
const DLX_EXCHANGE = 'stas.dlx';

const MAX_RETRIES = config.queue.maxRetries;
const RETRY_DELAYS = config.queue.retryDelays;

const DEDUP_TTL_MS = config.queue.dedupTtl * 1000;

interface EnqueueOptions {
  delay?: number;
  dedupKey?: string;
}

const recentMessages = new Map<string, number>();

export function clearDedupCache(): void {
  recentMessages.clear();
}

function isDuplicate(dedupKey: string): boolean {
  const now = Date.now();
  const lastSeen = recentMessages.get(dedupKey);
  if (lastSeen && (now - lastSeen) < DEDUP_TTL_MS) {
    return true;
  }
  recentMessages.set(dedupKey, now);
  if (recentMessages.size > 10000) {
    const cutoff = now - DEDUP_TTL_MS;
    for (const [key, ts] of recentMessages) {
      if (ts < cutoff) recentMessages.delete(key);
    }
  }
  return false;
}

export async function enqueueIssue(
  data: IssueJobData,
  options?: EnqueueOptions,
): Promise<string | undefined> {
  const repo = `${data.repoOwner}/${data.repoName}`;
  const dedupKey = options?.dedupKey ?? `issue:${data.installationId}:${repo}#${data.issueNumber}`;

  if (isDuplicate(dedupKey)) {
    log.warn({ repo, issueNumber: data.issueNumber, dedupKey }, 'Duplicate issue detected — skipping');
    return undefined;
  }

  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const headers: Record<string, string | number> = {
      'x-dedup-key': dedupKey,
      'x-message-id': messageId,
      'x-retry-count': '0',
    };

    if (options?.delay && options.delay > 0) {
      headers['x-delay'] = options.delay;
    }

    const success = await publishMessage(ISSUE_EXCHANGE, ISSUE_ROUTING_KEY, data, {
      headers,
      messageId,
      persistent: true,
      timestamp: Date.now(),
    });

    if (!success) {
      log.error({ repo, issueNumber: data.issueNumber }, 'Failed to publish message to RabbitMQ');
      return undefined;
    }

    log.info({ messageId, repo, issueNumber: data.issueNumber, dedupKey }, 'Issue enqueued via RabbitMQ');
    bridgeMetrics.incrementCounter('messages_published_total', { queue: ISSUE_QUEUE });

    return messageId;
  } catch (err) {
    log.error({ err: String(err), repo, issueNumber: data.issueNumber, dedupKey }, 'Failed to enqueue issue via RabbitMQ');
    return undefined;
  }
}

export async function createIssueWorker(): Promise<void> {
  await consumeQueue(ISSUE_QUEUE, async (msg) => {
    const headers = msg.properties.headers ?? {};
    const retryCount = Number(headers['x-retry-count'] ?? 0);
    const messageId = headers['x-message-id'] as string ?? 'unknown';
    const dedupKey = headers['x-dedup-key'] as string ?? '';

    let data: IssueJobData;
    try {
      data = JSON.parse(msg.content.toString()) as IssueJobData;
    } catch (err) {
      log.error({ err: String(err), messageId }, 'Failed to parse message content');
      getChannel().ack(msg);
      return;
    }

    const repo = `${data.repoOwner}/${data.repoName}`;
    log.info({ messageId, repo, issueNumber: data.issueNumber, attempt: retryCount + 1 }, 'Processing RabbitMQ issue job');

    const lockKey = `repo:${repo}:issue:${data.issueNumber}`;
    const lockAcquired = await acquireRepoLock(lockKey, 300_000);
    if (!lockAcquired) {
      log.warn({ repo, issueNumber: data.issueNumber }, 'Could not acquire repo lock — re-queuing');
      await requeueWithDelay(data, retryCount, 'Repo lock contention', 30_000);
      getChannel().ack(msg);
      return;
    }

    try {
      let result;
      try {
        result = await runIssueAgent(data, messageId);
      } catch (err) {
        const errorMsg = String(err);
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount] ?? 300_000;
          await requeueWithDelay(data, retryCount + 1, errorMsg, delay);
          log.info({ messageId, retryCount: retryCount + 1, delayMs: delay }, 'Scheduled RabbitMQ retry');
          getChannel().ack(msg);
          return;
        }
        await moveToDeadLetter(data, errorMsg, ISSUE_QUEUE);
        getChannel().ack(msg);
        return;
      }

      if (!result.fixReady) {
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount] ?? 300_000;
          await requeueWithDelay(data, retryCount + 1, result.noFixReason ?? 'Fix not ready', delay);
          log.info({ messageId, retryCount: retryCount + 1, delayMs: delay }, 'Scheduled retry for fix-not-ready');
        } else {
          await moveToDeadLetter(data, result.noFixReason ?? 'Fix not ready', ISSUE_QUEUE);
        }
      } else {
        log.info({ messageId, prUrl: result.prUrl }, 'Fix completed successfully');
        bridgeMetrics.incrementCounter('messages_processed_total', { queue: ISSUE_QUEUE, status: 'completed' });
      }

      getChannel().ack(msg);
    } catch (err) {
      const errorMsg = String(err);
      log.error({ err: errorMsg, messageId, repo, issueNumber: data.issueNumber }, 'Unhandled error in worker');
      getChannel().nack(msg, false, false);
      bridgeMetrics.incrementCounter('messages_processed_total', { queue: ISSUE_QUEUE, status: 'failed' });
    } finally {
      await releaseRepoLock(lockKey);
    }
  }, { noAck: false });

  log.info({ concurrency: config.queue.workerConcurrency }, 'RabbitMQ issue worker started');
}

async function requeueWithDelay(
  data: IssueJobData,
  newRetryCount: number,
  error: string,
  delayMs: number,
): Promise<void> {
  const headers: Record<string, string | number> = {
    'x-retry-count': newRetryCount,
    'x-dedup-key': `issue:${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`,
    'x-message-id': `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    'x-last-error': error.slice(0, 500),
    'x-delay': delayMs,
  };

  await publishMessage(RETRY_EXCHANGE, ISSUE_ROUTING_KEY, data, {
    headers,
    persistent: true,
    timestamp: Date.now(),
  });
}

async function moveToDeadLetter(
  data: IssueJobData,
  error: string,
  sourceQueue: string,
): Promise<void> {
  const entry = {
    id: `dlq-${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    jobData: data,
    error,
    sourceQueue,
    retryCount: MAX_RETRIES,
  };

  await publishMessage(DLX_EXCHANGE, '#', entry, {
    persistent: true,
    timestamp: Date.now(),
  });

  log.warn(
    { repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber, error },
    'Job moved to dead-letter queue',
  );

  bridgeMetrics.incrementCounter('dlq_messages_total', {
    queue: sourceQueue,
    repo: `${data.repoOwner}/${data.repoName}`,
  });

  await postIssueComment(data, messages.deadLetterComment(error));
}

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
    log.warn({ err: String(err) }, 'Failed to post issue comment');
  }
}
