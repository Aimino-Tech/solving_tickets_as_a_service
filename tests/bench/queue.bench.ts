/**
 * Benchmark: Queue Enqueue/Dequeue Performance
 *
 * Measures the time to:
 * 1. Enqueue a job to BullMQ (mocked Redis)
 * 2. Create and configure a worker
 * 3. Process a job (mocked handler)
 * 4. Dequeue and complete a job
 *
 * BullMQ's Redis calls are mocked — this measures the overhead of
 * constructing job data, dedup key computation, retry logic, etc.
 */

import { bench, describe } from 'vitest';
import { createMockJobData, createMockBullMQQueue, createMockBullMQWorker } from './setup.js';

const jobData = createMockJobData();

// ── Simulated enqueue logic ──────────────────────────────────────────

function computeDedupKey(data: typeof jobData): string {
  const repo = `${data.repoOwner}/${data.repoName}`;
  return `issue:${data.installationId}:${repo}#${data.issueNumber}`;
}

interface EnqueueResult {
  jobId: string;
  dedupKey: string;
  timestamp: number;
}

async function enqueueJob(data: typeof jobData, queue: ReturnType<typeof createMockBullMQQueue>): Promise<EnqueueResult> {
  const dedupKey = computeDedupKey(data);
  const job = await queue.add('process-issue', data, {
    deduplication: { id: dedupKey, ttl: 120 },
  });
  return {
    jobId: job.id,
    dedupKey,
    timestamp: Date.now(),
  };
}

// ── Simulated worker processing ──────────────────────────────────────

interface ProcessResult {
  summary: string;
  confidence: string;
  fixReady: boolean;
  errors?: string[];
}

async function processJob(data: typeof jobData): Promise<ProcessResult> {
  // Simulate building the initial result structure
  return {
    summary: `Processed issue #${data.issueNumber}: ${data.issueTitle}`,
    confidence: 'medium',
    fixReady: true,
  };
}

// ── Retry logic (matches issueQueue.ts) ──────────────────────────────

const RETRY_DELAYS = [30000, 120000, 300000, 900000];

function computeRetryDelay(retryCount: number): number {
  return RETRY_DELAYS[retryCount] ?? 900000;
}

function shouldRetry(retryCount: number, maxRetries: number): boolean {
  return retryCount < maxRetries;
}

describe('queue-operations', () => {
  bench('compute dedup key', () => {
    computeDedupKey(jobData);
  });

  bench('enqueue job (mocked BullMQ)', async () => {
    const queue = createMockBullMQQueue();
    await enqueueJob(jobData, queue);
  });

  bench('process job handler (mocked)', async () => {
    await processJob(jobData);
  });

  bench('compute retry delay from retry count', () => {
    for (let i = 0; i < 5; i++) {
      computeRetryDelay(i);
    }
  });

  bench('check retry eligibility', () => {
    shouldRetry(2, 4);
    shouldRetry(4, 4);
    shouldRetry(5, 4);
  });

  bench('full enqueue → process lifecycle (mocked)', async () => {
    const queue = createMockBullMQQueue();
    const enqueued = await enqueueJob(jobData, queue);
    const result = await processJob(jobData);
    // Simulate marking completion
    if (result.fixReady) {
      await queue.close();
    }
  });
});
