/**
 * Benchmark: Full Pipeline — Webhook → Job Created → Worker Picks Up
 *
 * This is the end-to-end benchmark that simulates the complete lifecycle:
 * 1. Webhook payload arrives (mocked)
 * 2. Signature verification + payload validation
 * 3. Job data construction
 * 4. Queue enqueue
 * 5. Worker picks up the job
 * 6. Triage classification (mocked)
 * 7. Result production
 *
 * All external dependencies are mocked. This measures the orchestration
 * overhead of the full pipeline, excluding actual fix execution.
 */

import { bench, describe } from 'vitest';
import {
  createMockWebhookPayload,
  createMockTriageInput,
  createMockTriageResult,
  createMockJobData,
  createMockBullMQQueue,
  createMockBullMQWorker,
} from './setup.js';

const webhookPayload = createMockWebhookPayload();
const triageInput = createMockTriageInput();
const triageResult = createMockTriageResult();
const jobData = createMockJobData();

// ── Phase 1: Webhook Ingestion ───────────────────────────────────────

interface IngestedWebhook {
  event: string;
  deliveryId: string;
  isValid: boolean;
  parsed: Record<string, unknown>;
  jobData: typeof jobData;
}

function ingestWebhook(payload: typeof webhookPayload): IngestedWebhook {
  const parsed = JSON.parse(payload.rawBody.toString()) as Record<string, unknown>;
  return {
    event: payload.event,
    deliveryId: payload.deliveryId,
    isValid: true,
    parsed,
    jobData,
  };
}

// ── Phase 2: Enqueue ─────────────────────────────────────────────────

async function enqueueForProcessing(
  data: typeof jobData,
  queue: ReturnType<typeof createMockBullMQQueue>,
): Promise<string> {
  const dedupKey = `issue:${data.installationId}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`;
  const job = await queue.add('process-issue', data, {
    deduplication: { id: dedupKey, ttl: 120 },
  });
  return job.id;
}

// ── Phase 3: Worker Processing ───────────────────────────────────────

async function workerProcess(
  data: typeof jobData,
): Promise<{ summary: string; triage: typeof triageResult; fixReady: boolean }> {
  // Simulate triage classification
  const triage = { ...triageResult };

  // Simulate the minimum viable result
  return {
    summary: `[Bench] Processed #${data.issueNumber}`,
    triage,
    fixReady: triage.type === 'bug',
  };
}

// ── Full Pipeline ────────────────────────────────────────────────────

async function fullPipeline(): Promise<{
  webhook: IngestedWebhook;
  jobId: string;
  result: Awaited<ReturnType<typeof workerProcess>>;
}> {
  // Phase 1: Ingest webhook
  const webhook = ingestWebhook(webhookPayload);

  // Phase 2: Enqueue
  const queue = createMockBullMQQueue();
  const jobId = await enqueueForProcessing(webhook.jobData, queue);

  // Phase 3: Worker picks up and processes
  const result = await workerProcess(webhook.jobData);

  return { webhook, jobId, result };
}

describe('full-pipeline', () => {
  bench('phase 1: webhook ingestion + parse', () => {
    ingestWebhook(webhookPayload);
  });

  bench('phase 2: enqueue to BullMQ (mocked)', async () => {
    const queue = createMockBullMQQueue();
    await enqueueForProcessing(jobData, queue);
  });

  bench('phase 3: worker process + triage (mocked)', async () => {
    await workerProcess(jobData);
  });

  bench('full pipeline: webhook → job → worker (mocked)', async () => {
    await fullPipeline();
  });
});
