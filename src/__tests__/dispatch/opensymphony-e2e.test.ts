import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToOpenSymphony } from '../../dispatch/osDispatch.js';
import type { IssueJobData } from '../../utils/types.js';

vi.mock('../../config.js', () => ({
  config: {
    opensymphony: {
      dispatchUrl: 'http://test-os:4000/api/v1/dispatch',
      apiKey: 'test-api-key',
      tenant: 'test-tenant',
      celeryPipeline: false,
    },
  },
}));

vi.mock('../../dispatch/celeryDispatcher.js', () => ({
  dispatchFullPipeline: vi.fn(),
}));

const mockIssueData: IssueJobData = {
  trackerTicketId: 'GH-42',
  issueNumber: 42,
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  issueTitle: 'Test issue',
  issueBody: 'Test body',
  labels: ['bug'],
  source: 'github',
  trackerType: 'github',
  installationId: 12345,
  repoPrivate: false,
};

describe('OpenSymphony dispatch E2E', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends issue to OpenSymphony HTTP endpoint and gets accepted', async () => {
    const mockResponse = {
      run_id: 'os-run-abc123',
      summary: 'Dispatched successfully',
      pr_url: 'https://github.com/test-owner/test-repo/pull/42',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await dispatchToOpenSymphony(mockIssueData);

    expect(result.success).toBe(true);
    expect(result.runId).toBe('os-run-abc123');
    expect(result.prUrl).toBe('https://github.com/test-owner/test-repo/pull/42');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-os:4000/api/v1/dispatch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-API-Key': 'test-api-key',
        }),
        body: expect.any(String),
      }),
    );

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({
      issue_id: 'GH-42',
      repo: 'test-owner/test-repo',
      tenant: 'test-tenant',
      title: 'Test issue',
      body: 'Test body',
      labels: ['bug'],
      source: 'github',
      tracker_type: 'github',
      tracker_ticket_id: 'GH-42',
      installation_id: 12345,
    });
  });

  it('returns error when HTTP endpoint returns 4xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const result = await dispatchToOpenSymphony(mockIssueData);

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain('401');
  });

  it('returns error when HTTP endpoint returns 5xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    });

    const result = await dispatchToOpenSymphony(mockIssueData);

    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('503');
  });

  it('handles network failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:4000'));

    const result = await dispatchToOpenSymphony(mockIssueData);

    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('ECONNREFUSED');
  });

  it('handles fetch timeout gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

    const result = await dispatchToOpenSymphony(mockIssueData);

    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('aborted');
  });

  it('returns error when dispatch URL is not configured', async () => {
    const osyModule = await import('../../dispatch/osDispatch.js');
    const cfgModule = await import('../../config.js');
    const originalUrl = cfgModule.config.opensymphony.dispatchUrl;

    Object.defineProperty(cfgModule.config.opensymphony, 'dispatchUrl', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const result = await osyModule.dispatchToOpenSymphony(mockIssueData);

    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('No dispatch target available');

    Object.defineProperty(cfgModule.config.opensymphony, 'dispatchUrl', {
      value: originalUrl,
      configurable: true,
      writable: true,
    });
  });
});
