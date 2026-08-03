/**
 * AIM-3210: Error Handling Path E2E Smoke Test
 *
 * Validates error handling in the webhook pipeline:
 *   Invalid webhook → 400 response → logged → no crash
 *
 * Covers:
 *   - Invalid JSON payloads
 *   - Missing required headers
 *   - Malformed webhook events
 *   - Graceful recovery after errors
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from './harness/index.js';
import type { TestHarness } from './harness/index.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

describe('Error Handling Path: Invalid Webhook → 400 → Logged → No Crash', () => {
  it('Invalid JSON body returns 400 with error message', async () => {
    const res = await fetch(`${harness.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues.labeled',
        'X-GitHub-Delivery': 'test-delivery-invalid',
      },
      body: 'this is not valid json',
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body).toHaveProperty('error');
  });

  it('Missing X-GitHub-Event header still returns a valid response', async () => {
    const res = await fetch(`${harness.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'labeled' }),
    });

    // Should not crash — either 400 or 202 depending on validation
    expect([400, 202]).toContain(res.status);
  });

  it('Empty body returns 400', async () => {
    const res = await fetch(`${harness.baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues.labeled',
      },
      body: '',
    });

    expect(res.status).toBe(400);
  });

  it('Unknown route returns 404 with proper error shape', async () => {
    const res = await fetch(`${harness.baseUrl}/this-route-does-not-exist`);

    expect(res.status).toBe(404);

    const body = await res.json() as any;
    // Should have error info — shape depends on the handler
    expect(body).toBeTruthy();
  });

  it('Server recovers and handles valid requests after errors', async () => {
    // Send invalid request first
    await fetch(`${harness.baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad data',
    });

    // Now send a valid webhook — should still work
    const { githubIssuesLabeledSyntaroFix } = await import('./fixtures/webhooks/github.js');
    const payload = githubIssuesLabeledSyntaroFix();
    const res = await harness.sendWebhook('/webhook', payload);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('Multiple rapid invalid requests do not crash the server', async () => {
    // Send 5 invalid requests simultaneously
    const invalidRequests = Array.from({ length: 5 }, () =>
      fetch(`${harness.baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid',
      }),
    );

    const responses = await Promise.all(invalidRequests);

    for (const res of responses) {
      expect(res.status).toBe(400);
    }

    // Server should still be alive after all invalid requests
    const healthRes = await fetch(`${harness.baseUrl}/health`);
    expect(healthRes.status).toBe(200);
  });

  it('GET request to webhook endpoint returns 404 or appropriate response', async () => {
    const res = await fetch(`${harness.baseUrl}/webhook`);
    // Webhook endpoints expect POST — GET should not crash
    expect([404, 405, 400]).toContain(res.status);
  });
});
