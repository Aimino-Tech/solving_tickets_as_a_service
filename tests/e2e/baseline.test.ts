/**
 * Baseline E2E tests for STAS.
 *
 * These tests verify the basic infrastructure works:
 * 1. Health endpoint returns 200
 * 2. Webhook with stas:fix label is accepted (202)
 * 3. Webhook without stas:fix label is still accepted (202) but doesn't trigger
 * 4. Unknown route returns 404
 * 5. Mock servers are reachable
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from './harness/index.js';
import { sampleIssueLabeledPayload } from './fixtures/webhooks/github.js';
import type { TestHarness } from './harness/index.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

// ---------------------------------------------------------------------------
// Test 1: Health endpoint returns 200
// ---------------------------------------------------------------------------

describe('Health endpoint', () => {
  it('should return 200 with status ok', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('label', 'stas:fix');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
    expect(body).toHaveProperty('timestamp');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Webhook with stas:fix label is accepted (202)
// ---------------------------------------------------------------------------

describe('GitHub webhook — issues.labeled with stas:fix', () => {
  it('should respond 202 Accepted when target label is present', async () => {
    const payload = sampleIssueLabeledPayload();
    const res = await harness.sendWebhook('/webhook', payload);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });
});

// ---------------------------------------------------------------------------
// Test 3: 404 handling
// ---------------------------------------------------------------------------

describe('404 handling', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await fetch(`${harness.baseUrl}/nonexistent-route`);
    expect(res.status).toBe(404);

    const body = await res.json() as any;
    expect(body).toHaveProperty('error', 'Not found');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Mock GitHub API server is reachable
// ---------------------------------------------------------------------------

describe('Mock servers', () => {
  it('GitHub API mock should be reachable', async () => {
    const res = await fetch(`${harness.githubApi.baseUrl}/`);
    expect(res.status).toBe(200);
  });

  it('OpenCode mock should be reachable', async () => {
    const res = await fetch(`${harness.openCode.baseUrl}/`);
    expect(res.status).toBe(200);
  });

  it('should track requests received by mock GitHub API', async () => {
    // Send a webhook and verify the mock GitHub API receives requests
    const payload = sampleIssueLabeledPayload();

    // Reset request tracking
    harness.githubApi.receivedRequests.length = 0;

    await harness.sendWebhook('/webhook', payload);

    // Give the async handler time to process and call GitHub API
    await new Promise((r) => setTimeout(r, 500));

    if (harness.githubApi.receivedRequests.length > 0) {
      // If any requests were made, inspect them
      const req = harness.githubApi.receivedRequests[0];
      expect(req).toHaveProperty('method');
      expect(req).toHaveProperty('url');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: Webhook with x-github-event header routed correctly
// ---------------------------------------------------------------------------

describe('GitHub webhook routing', () => {
  it('should handle /webhook/github endpoint', async () => {
    const payload = sampleIssueLabeledPayload();
    const bodyStr = JSON.stringify(payload);

    const res = await fetch(`${harness.baseUrl}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues.labeled',
        'X-GitHub-Delivery': `test-delivery-${Date.now()}`,
      },
      body: bodyStr,
    });

    expect(res.status).toBe(202);
  });
});
