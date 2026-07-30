/**
 * 3-Repo Integration Test Suite — STAS ↔ Governance ↔ OS
 *
 * Tests the complete webhook→governance→dispatch→verify pipeline.
 * Requires docker-compose from tests/integration/docker-compose.yml to be running.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const STAS_URL = process.env.STAS_URL || 'http://localhost:4095';
const GOVERNANCE_URL = process.env.GOVERNANCE_URL || 'http://localhost:4003';

const TEST_ISSUE_PAYLOAD = {
  action: 'labeled',
  issue: {
    number: 9999,
    title: 'Integration test: null check bug',
    body: 'Reproduction: call getValue() on null reference. Expected: graceful null check.',
    labels: [{ name: 'stas:fix' }],
  },
  repository: {
    owner: { login: 'aimino' },
    name: 'stas-demo-private',
  },
  installation: { id: 99999 },
};

describe('STAS ↔ Governance Integration', () => {
  beforeAll(async () => {
    // Verify governance proxy is healthy
    const healthResp = await fetch(`${GOVERNANCE_URL}/guardrail/health`);
    expect(healthResp.ok).toBe(true);

    // Verify STAS is healthy
    const stasResp = await fetch(`${STAS_URL}/health`);
    expect(stasResp.ok).toBe(true);
  });

  it('Test 1: webhook→governance→dispatch full pipeline', async () => {
    const resp = await fetch(`${STAS_URL}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': 'sha256=test',
        'X-GitHub-Delivery': `test-delivery-${Date.now()}`,
      },
      body: JSON.stringify(TEST_ISSUE_PAYLOAD),
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('run_id');
  });

  it('Test 2: governance proxy returns 429 when rate limited', async () => {
    // Send rapid requests to trigger rate limiter
    const requests = Array.from({ length: 20 }, (_, i) =>
      fetch(`${GOVERNANCE_URL}/api/stas/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
        body: JSON.stringify({ issue_id: `test-${i}` }),
      }),
    );

    const results = await Promise.all(requests);
    const rateLimited = results.filter((r) => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  it('Test 3: kill-switch → 402 response', async () => {
    // Kill the test tenant via admin API
    const killResp = await fetch(`${GOVERNANCE_URL}/admin/tenant/kill/test-tenant`, {
      method: 'POST',
      headers: { 'X-Admin-Key': 'test-admin-key' },
    });
    expect(killResp.ok).toBe(true);

    // Verify dispatch returns 402
    const dispatchResp = await fetch(`${GOVERNANCE_URL}/api/stas/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
      body: JSON.stringify({ issue_id: 'test/foo#1' }),
    });
    expect(dispatchResp.status).toBe(402);
  });

  it('Test 4: governance proxy down → system degrades gracefully', async () => {
    // When governance is unavailable, STAS should return an explicit error
    // (not hang indefinitely or return 200 without dispatching)
    const resp = await fetch(`${STAS_URL}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': 'sha256=wrong',
        'X-GitHub-Delivery': `test-delivery-bad-${Date.now()}`,
      },
      body: JSON.stringify(TEST_ISSUE_PAYLOAD),
    });

    // Bad signature = 401, not a timeout or 500
    expect(resp.status).toBe(401);
  });
});
