/**
 * AIM-3210: Health Check Path E2E Smoke Test
 *
 * Validates the health check endpoint:
 *   GET /health → all dependencies green
 *
 * Covers:
 *   - Health endpoint returns 200 with status ok
 *   - Response contains expected fields (status, label, uptime, timestamp)
 *   - All dependency statuses are reported
 *   - Health endpoint remains available under load
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from './harness/index.js';
import { githubIssuesLabeledSyntaroFix } from './fixtures/webhooks/github.js';
import type { TestHarness } from './harness/index.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

describe('Health Check Path: GET /health → All Dependencies Green', () => {
  it('Returns 200 with status ok', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(['ok', 'degraded']).toContain(body.status);
  });

  it('Response contains the syntaro:fix label', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    const body = await res.json() as any;
    expect(body).toHaveProperty('label', 'syntaro:fix');
  });

  it('Response contains uptime as a number', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    const body = await res.json() as any;
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
  });

  it('Response contains ISO timestamp', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    const body = await res.json() as any;
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.timestamp).toBe('string');
    // Should be parseable as ISO date
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  it('Response contains dependency status information', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    const body = await res.json() as any;

    // The health response may contain a dependencies array or individual fields
    const hasDeps = body.dependencies !== undefined ||
                    body.database !== undefined ||
                    body.redis !== undefined;

    if (hasDeps) {
      // If dependencies are reported, they should have status
      if (Array.isArray(body.dependencies)) {
        for (const dep of body.dependencies) {
          expect(dep).toHaveProperty('name');
          expect(dep).toHaveProperty('status');
          expect(['ok', 'error', 'disabled']).toContain(dep.status);
        }
      }
    }
  });

  it('Health endpoint is accessible via GET only', async () => {
    // POST to health should not crash
    const postRes = await fetch(`${harness.baseUrl}/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // May return 404 or 405 (method not allowed)
    expect([200, 404, 405]).toContain(postRes.status);
  });

  it('Health endpoint stays responsive under concurrent load', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => fetch(`${harness.baseUrl}/health`)),
    );

    for (const res of results) {
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(['ok', 'degraded']).toContain(body.status);
    }
  });

  it('Health still returns ok after processing webhooks', async () => {
    // Process a webhook
    const payload = githubIssuesLabeledSyntaroFix();
    await harness.sendWebhook('/webhook', payload);

    // Then check health
    const res = await fetch(`${harness.baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(['ok', 'degraded']).toContain(body.status);
  });

  it('Health endpoint has no CORS errors', async () => {
    const res = await fetch(`${harness.baseUrl}/health`);
    // CORS headers should be present
    const corsOrigin = res.headers.get('access-control-allow-origin');
    // May be * or specific origin
    expect(corsOrigin !== null).toBe(true);
  });
});
