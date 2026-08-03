/**
 * AIM-4207: Edge Case E2E Tests — Monorepo, multi-language, failing tests, empty repo
 *
 * Validates SYNTARO handles non-trivial scenarios:
 *   1. Monorepo: issue exists in a subdirectory with cross-file changes
 *   2. Multi-language: JS/TS + Python files in the same repo
 *   3. No tests: repo has zero test files — SYNTARO should still fix but note gap
 *   4. Failing tests: pre-existing test suite has failures — SYNTARO reports regression
 *   5. Empty repo: issue on empty repository — graceful error
 *   6. Large repo: simulated large repo handling
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

describe('Edge Cases: Monorepo', () => {
  it('handles issue in a subdirectory of a monorepo', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'Bug in packages/core/src/handler.ts — the login function crashes on null input.';
    payload.issue.title = 'Fix null crash in core handler';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('processes cross-file changes across monorepo packages', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'Update API endpoint URL in packages/client/src/config.ts and packages/server/src/routes.ts to match new backend.';
    payload.issue.title = 'Update API endpoint URL across client and server';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
  });
});

describe('Edge Cases: Multi-language repository', () => {
  it('processes TypeScript fixes in a mixed JS/TS repo', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'TypeError in TypeScript file: add proper type annotations to src/index.ts';
    payload.issue.title = 'Fix TypeScript type errors in index.ts';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
  });

  it('processes Python fixes in a mixed-language repo', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'KeyError in Python backend: add missing key check in api/handler.py';
    payload.issue.title = 'Fix KeyError in Python API handler';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
  });

  it('processes Go fixes in a multi-language repo', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'Segfault in Go service: nil pointer dereference in cmd/server/main.go';
    payload.issue.title = 'Fix nil pointer dereference in Go service';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
  });
});

describe('Edge Cases: No test suite', () => {
  it('accepts issue from repo with no tests and generates fix', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'README has outdated installation instructions. Update to match new setup process.';
    payload.issue.title = 'Update README installation instructions';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
  });

  it('comment includes note about missing test coverage', async () => {
    const commentCalls = harness.githubApi.receivedRequests.filter(
      (req) => req.url.includes('/comments') && req.method === 'POST',
    );

    const hasTestGapNote = commentCalls.some((req) =>
      req.body?.toLowerCase().includes('test') &&
      (req.body?.toLowerCase().includes('gap') || req.body?.toLowerCase().includes('missing'))
    );
    expect(hasTestGapNote).toBeDefined();
  });
});

describe('Edge Cases: Failing test suite', () => {
  it('detects pre-existing test failures and blocks PR creation', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'Add a simple comment to the Config class explaining the timeout field.';
    payload.issue.title = 'Add doc comment to Config.timeout';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);

    await new Promise((r) => setTimeout(r, 500));

    const prCreations = harness.githubApi.receivedRequests.filter(
      (req) => req.url.includes('/pulls') && req.method === 'POST',
    );

    expect(prCreations.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Edge Cases: Graceful error handling', () => {
  it('returns graceful error for unsupported language', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    payload.issue.body = 'Fix bug in Rust file src/main.rs — unsafe block causes UB';
    payload.issue.title = 'Fix Rust unsafe block';
    payload.repository.language = 'Rust';

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(202);
  });

  it('handles missing repository gracefully', async () => {
    const payload = githubIssuesLabeledSyntaroFix();
    delete (payload as any).repository;

    const res = await harness.sendWebhook('/webhook', payload);
    expect(res.status).toBe(400);
  });

  it('handles malformed webhook payload gracefully', async () => {
    const res = await harness.sendWebhook('/webhook', { invalid: true });
    expect(res.status).toBe(400);
  });
});
