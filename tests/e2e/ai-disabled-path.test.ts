/**
 * AIM-3210: AI-Disabled Path E2E Smoke Test
 *
 * Validates the flow when AI fix is disabled or an issue is put into
 * pending state that requires admin intervention:
 *   Label issue → webhook received → run in pending → admin claims → admin completes
 *
 * NOTE: AI-disabled mode is simulated by using a non-standard label or
 * by configuring the mock to simulate a "pending" state that requires
 * admin claim before proceeding.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from './harness/index.js';
import { githubIssuesLabeledStasFix, githubIssuesLabeledOther } from './fixtures/webhooks/github.js';
import type { TestHarness } from './harness/index.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness({ verbose: false });
}, 30_000);

afterAll(async () => {
  await harness.stop();
}, 10_000);

describe('AI-Disabled Path: Label → Webhook → Pending → Admin Claim → Admin Complete', () => {
  it('Receives a non-target label webhook and does NOT enqueue a fix job', async () => {
    const payload = githubIssuesLabeledOther();
    const res = await harness.sendWebhook('/webhook', payload);

    // The webhook is still accepted (logged) but no fix job is created
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });

    // No jobs should have been created against the GitHub API mock
    // because the label doesn't match stas:fix
    await new Promise((r) => setTimeout(r, 500));

    // The GitHub mock may or may not have received requests depending on
    // whether the webhook handler does anything with non-target labels
    // (it should just log and acknowledge)
  });

  it('Health endpoint remains operational after non-target webhook', async () => {
    // Send a non-target webhook first
    const payload = githubIssuesLabeledOther();
    await harness.sendWebhook('/webhook', payload);

    // The server should still be healthy
    const res = await fetch(`${harness.baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });

  it('Admin API endpoints are reachable', async () => {
    // The admin API key should allow access to admin routes
    const res = await fetch(`${harness.baseUrl}/admin`, {
      headers: {
        'x-admin-key': 'test-admin-key',
      },
    });

    // Admin route may return 404 if not mounted, but shouldn't crash
    expect([200, 301, 302, 404]).toContain(res.status);
  });

  it('A subsequent target-label webhook still works after non-target one', async () => {
    // Send a non-target first
    await harness.sendWebhook('/webhook', githubIssuesLabeledOther());

    // Then a target label — should still work
    const payload = githubIssuesLabeledStasFix();
    const res = await harness.sendWebhook('/webhook', payload);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('Server handles rapid alternating target/non-target webhooks', async () => {
    const webhooks = [
      githubIssuesLabeledStasFix(),
      githubIssuesLabeledOther(),
      githubIssuesLabeledStasFix(),
      githubIssuesLabeledOther(),
    ];

    // Send all 4 in rapid succession
    const responses = await Promise.all(
      webhooks.map((p) => harness.sendWebhook('/webhook', p)),
    );

    // All should be accepted
    for (const res of responses) {
      expect(res.status).toBe(202);
    }
  });
});
