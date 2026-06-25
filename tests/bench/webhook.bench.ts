/**
 * Benchmark: Webhook Ingestion Latency
 *
 * Measures the time to:
 * 1. Parse a raw webhook payload
 * 2. Verify HMAC-SHA256 signature
 * 3. Validate payload schema
 * 4. Enqueue the job to BullMQ (mocked)
 *
 * All external dependencies are mocked. This benchmark measures pure
 * computational overhead of the webhook ingestion pipeline.
 */

import { bench, describe } from 'vitest';
import { createMockWebhookPayload } from './setup.js';

// Pre-create payload once (shared across iterations for consistency)
const payload = createMockWebhookPayload();

// Simulated HMAC verification
function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const crypto = require('node:crypto');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signature.replace(/^sha256=/, '');
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// Simulated payload validation
function validatePayload(event: string, parsed: unknown): { success: boolean; errors?: string[] } {
  if (!event) return { success: false, errors: ['Missing event'] };
  if (!parsed || typeof parsed !== 'object') return { success: false, errors: ['Invalid payload'] };
  return { success: true };
}

// Simulated enqueue (mocked — no BullMQ Redis calls)
async function enqueueMock(data: unknown): Promise<{ jobId: string }> {
  // Simulate ~50μs of serialization overhead
  const serialized = JSON.stringify(data);
  return { jobId: 'mock-job-' + Buffer.from(serialized).length };
}

describe('webhook-ingestion', () => {
  bench('parse raw body (JSON.parse)', () => {
    JSON.parse(payload.rawBody.toString());
  });

  bench('verify HMAC-SHA256 signature', () => {
    verifySignature(payload.rawBody, payload.signature, 'mock-secret-key');
  });

  bench('validate payload schema', () => {
    validatePayload(payload.event, payload.parsed);
  });

  bench('enqueue job (mocked)', async () => {
    await enqueueMock(payload.parsed);
  });

  bench('full webhook pipeline (parse → verify → validate → enqueue)', async () => {
    const parsed = JSON.parse(payload.rawBody.toString());
    verifySignature(payload.rawBody, payload.signature, 'mock-secret-key');
    validatePayload(payload.event, parsed);
    await enqueueMock(parsed);
  });
});
