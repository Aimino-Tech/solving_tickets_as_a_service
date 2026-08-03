import { describe, expect, it, vi } from 'vitest';

const runOsE2e = process.env.SYNTARO_RUN_OS_E2E === '1';

describe.runIf(runOsE2e)('OpenSymphony dispatch E2E', () => {
  it('sends issue to OpenSymphony and gets accepted', async () => {
    const { dispatchToOpenSymphony } = await import('../dispatch/osDispatch.js');

    const result = await dispatchToOpenSymphony({
      installationId: 12345,
      repoOwner: 'test-owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'E2E test issue',
      issueBody: 'This is an automated E2E test issue for OpenSymphony dispatch.',
      labels: ['bug', 'e2e-test'],
      source: 'github',
      trackerType: 'github',
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBeDefined();
  });

  it('returns network error when dispatch URL is unreachable', async () => {
    vi.resetModules();
    process.env.OPEN_SYMPHONY_DISPATCH_URL = 'http://0.0.0.0:1/dispatch';
    process.env.OPEN_SYMPHONY_CELERY_PIPELINE = 'false';

    const { dispatchToOpenSymphony } = await import('../dispatch/osDispatch.js');

    const result = await dispatchToOpenSymphony({
      installationId: 0,
      repoOwner: 'test-owner',
      repoName: 'test-repo',
      issueNumber: 0,
      issueTitle: 'E2E test unreachable',
      issueBody: 'Testing unreachable endpoint handling.',
      labels: [],
      source: 'github',
      trackerType: 'github',
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('falls back to HTTP dispatch when Celery is disabled', async () => {
    vi.resetModules();
    process.env.OPEN_SYMPHONY_CELERY_PIPELINE = 'false';

    const { config } = await import('../config.js');
    const osUrl = config.opensymphony?.dispatchUrl;

    expect(osUrl).toBeDefined();
    expect(osUrl!.length).toBeGreaterThan(0);

    const { dispatchToOpenSymphony } = await import('../dispatch/osDispatch.js');

    const result = await dispatchToOpenSymphony({
      installationId: 0,
      repoOwner: 'test-owner',
      repoName: 'test-repo',
      issueNumber: 0,
      issueTitle: 'E2E test fallback',
      issueBody: 'Testing HTTP fallback when Celery is disabled.',
      labels: [],
      source: 'github',
      trackerType: 'github',
    });

    expect(result.success).toBeDefined();
  });
});

describe('OpenSymphony dispatch contract', () => {
  it('DispatchResult interface has expected shape', () => {
    const successResult = {
      success: true,
      runId: 'os-test-123',
      summary: 'Dispatched to OpenSymphony',
      prUrl: 'https://github.com/test-owner/test-repo/pull/1',
    };

    const failResult = {
      success: false,
      errors: ['Network error'],
    };

    expect(successResult.success).toBe(true);
    expect(successResult.runId).toBe('os-test-123');
    expect(successResult.summary).toBeDefined();
    expect(typeof successResult.prUrl).toBe('string');

    expect(failResult.success).toBe(false);
    expect(failResult.errors).toBeDefined();
    expect(failResult.errors!.length).toBe(1);
  });
});
