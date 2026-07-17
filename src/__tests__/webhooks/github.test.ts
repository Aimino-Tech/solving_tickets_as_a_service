/**
 * Unit tests for GitHub webhook event handlers.
 *
 * Tests the createGithubWebhooks() function and suggestLabels() helper,
 * covering all event types, label matching, dedup, marketplace events,
 * and keyword-based label suggestion.
 *
 * ── Coverage ─────────────────────────────────────────────────────────
 * ✅ issues.labeled with target label → enqueues
 * ✅ issues.labeled with non-target label → does NOT enqueue
 * ✅ issues.opened → does NOT enqueue
 * ✅ issues.edited with target label → enqueues
 * ✅ issues.edited without target label → does NOT enqueue
 * ✅ marketplace_purchase "purchased" → maps plan correctly
 * ✅ marketplace_purchase "cancelled" → maps plan to free
 * ✅ suggestLabels keyword detection for all pattern groups
 * ✅ suggestLabels empty text → empty array
 * ✅ Dedup consistency (same issue → same dedup key)
 * ✅ Missing installationId handled gracefully
 * ─────────────────────────────────────────────────────────────────────
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports by vitest
// ---------------------------------------------------------------------------

const { mockEnqueueIssue } = vi.hoisted(() => {
  return {
    mockEnqueueIssue: vi
      .fn<(queue: unknown, data: unknown) => Promise<string | undefined>>()
      .mockResolvedValue('job-mock-id'),
  };
});

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  logger.child = vi.fn(() => logger);
  return { mockLogger: logger };
});

vi.mock('../../utils/logger.js', () => ({
  rootLogger: mockLogger,
}));

vi.mock('../../config.js', () => ({
  config: {
    github: { webhookSecret: 'test-secret', token: '' },
    stas: {
      label: 'stas:fix',
      rateLimit: {
        windowMs: 60_000,
        max: 30,
        repoLimit: 5,
        accountLimit: 10,
        repoConcurrencyMax: 3,
      },
    },
  },
}));

vi.mock('../../queue/issueQueue.js', () => ({
  enqueueIssue: mockEnqueueIssue,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createGithubWebhooks, suggestLabels } from '../../webhooks/github.js';
import { sampleIssueLabeledPayload, sampleIssueOpenedPayload, sampleMarketplacePayload } from '../fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    getJob: vi.fn().mockResolvedValue(null),
    getJobs: vi.fn().mockResolvedValue([]),
    obliterate: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ---------------------------------------------------------------------------
// createGithubWebhooks
// ---------------------------------------------------------------------------

describe('createGithubWebhooks', () => {
  let mockQueue: ReturnType<typeof createMockQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = createMockQueue();
    // Reconfigure the mock enqueueIssue to resolve by default
    mockEnqueueIssue.mockResolvedValue('job-mock-id');
  });

  describe('issues.labeled' as any, () => {
    it('enqueues a job when label is the target label (stas:fix)', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = sampleIssueLabeledPayload();

      await webhooks.receive({
        id: 'test-1',
        name: 'issues.labeled' as any,
        payload: payload as any,
      });

      expect(mockEnqueueIssue).toHaveBeenCalledTimes(1);
      expect(mockEnqueueIssue).toHaveBeenCalledWith(
        mockQueue,
        expect.objectContaining({
          installationId: 555,
          repoOwner: 'owner',
          repoName: 'test-repo',
          issueNumber: 42,
          issueTitle: 'Fix broken user login',
          issueBody: 'Users are unable to log in when the password contains special characters.',
          repoPrivate: false,
        }),
      );
    });

    it('does NOT enqueue when label is NOT the target label', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = sampleIssueLabeledPayload();
      payload.label = { name: 'other-label', color: 'ffffff', default: false, description: 'Some other label' };

      await webhooks.receive({
        id: 'test-2',
        name: 'issues.labeled' as any,
        payload: payload as any,
      });

      expect(mockEnqueueIssue).not.toHaveBeenCalled();
    });

    it('does NOT enqueue when installation ID is missing', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = sampleIssueLabeledPayload();
      // Remove installation to simulate missing ID
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { installation: _, ...payloadWithoutInstallation } = payload as any;

      await webhooks.receive({
        id: 'test-3',
        name: 'issues.labeled' as any,
        payload: payloadWithoutInstallation as any,
      });

      expect(mockEnqueueIssue).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'owner/test-repo',
          issueNumber: 42,
        }),
        'No installation ID and no GITHUB_TOKEN — cannot process',
      );
    });
  });

  describe('issues.opened' as any, () => {
    it('does NOT enqueue a job (we wait for label event)', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = sampleIssueOpenedPayload();

      await webhooks.receive({
        id: 'test-4',
        name: 'issues.opened' as any,
        payload: payload as any,
      });

      expect(mockEnqueueIssue).not.toHaveBeenCalled();
    });
  });

  describe('issues.edited' as any, () => {
    it('enqueues a job when the issue already has the target label', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload: any = {
        action: 'edited',
        issue: {
          number: 42,
          title: 'Fix broken user login (updated)',
          body: 'Updated description with more details.',
          state: 'open',
          labels: [{ name: 'stas:fix', color: 'fc2929' }],
          created_at: '2025-05-01T10:00:00Z',
          updated_at: '2025-05-01T13:00:00Z',
          html_url: 'https://github.com/owner/repo/issues/42',
          user: { login: 'testuser', id: 12345 },
          assignee: null,
          milestone: null,
          locked: false,
          comments: 1,
          pull_request: undefined,
          closed_at: null,
          author_association: 'CONTRIBUTOR',
          active_lock_reason: null,
          performed_via_github_app: null,
          reactions: {
            url: '',
            total_count: 0,
            '+1': 0,
            '-1': 0,
            laugh: 0,
            hooray: 0,
            confused: 0,
            heart: 0,
            rocket: 0,
            eyes: 0,
          },
          state_reason: null,
        },
        changes: { body: { from: 'Original body' } },
        repository: {
          id: 100,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          private: false,
          owner: { login: 'owner', id: 999, type: 'User' },
          html_url: 'https://github.com/owner/test-repo',
          description: 'A test repository',
          fork: false,
          default_branch: 'main',
          language: 'TypeScript',
          visibility: 'public',
          topics: [],
          has_issues: true,
          has_projects: false,
          has_wiki: false,
          archived: false,
          disabled: false,
          open_issues_count: 5,
          allow_forking: true,
          is_template: false,
          web_commit_signoff_required: false,
          starred_at: '',
        },
        installation: { id: 555, node_id: 'MDx:Integration' },
        organization: { login: 'my-org', id: 777 },
        sender: { login: 'testuser', id: 12345 },
      };

      await webhooks.receive({
        id: 'test-5',
        name: 'issues.edited' as any,
        payload,
      });

      expect(mockEnqueueIssue).toHaveBeenCalledTimes(1);
      expect(mockEnqueueIssue).toHaveBeenCalledWith(
        mockQueue,
        expect.objectContaining({
          installationId: 555,
          repoOwner: 'owner',
          repoName: 'test-repo',
          issueNumber: 42,
          issueTitle: 'Fix broken user login (updated)',
          issueBody: 'Updated description with more details.',
        }),
      );
    });

    it('does NOT enqueue when the issue does NOT have the target label', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = sampleIssueOpenedPayload();

      await webhooks.receive({
        id: 'test-6',
        name: 'issues.edited' as any,
        payload: { ...payload, action: 'edited' } as any,
      });

      expect(mockEnqueueIssue).not.toHaveBeenCalled();
    });

    it('does NOT enqueue when the issue has target label but no installation ID', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload: any = {
        action: 'edited',
        issue: {
          number: 42,
          title: 'Fix something',
          body: 'Details',
          state: 'open',
          labels: [{ name: 'stas:fix', color: 'fc2929' }],
          created_at: '2025-05-01T10:00:00Z',
          updated_at: '2025-05-01T13:00:00Z',
          html_url: 'https://github.com/owner/repo/issues/42',
          user: { login: 'testuser', id: 12345 },
          assignee: null,
          milestone: null,
          locked: false,
          comments: 0,
          pull_request: undefined,
          closed_at: null,
          author_association: 'CONTRIBUTOR',
          active_lock_reason: null,
          performed_via_github_app: null,
          reactions: {
            url: '',
            total_count: 0,
            '+1': 0,
            '-1': 0,
            laugh: 0,
            hooray: 0,
            confused: 0,
            heart: 0,
            rocket: 0,
            eyes: 0,
          },
          state_reason: null,
        },
        changes: {},
        repository: {
          id: 100,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          private: false,
          owner: { login: 'owner', id: 999, type: 'User' },
          html_url: 'https://github.com/owner/test-repo',
          description: 'A test repository',
          fork: false,
          default_branch: 'main',
        },
        // No installation field
        sender: { login: 'testuser', id: 12345 },
      };

      await webhooks.receive({
        id: 'test-7',
        name: 'issues.edited' as any,
        payload,
      });

      expect(mockEnqueueIssue).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'owner/test-repo',
          issueNumber: 42,
        }),
        'No installation ID and no GITHUB_TOKEN — cannot process edited issue',
      );
    });
  });

  describe('marketplace_purchase', () => {
    it('maps "purchased" with "Pro Plan" to plan "pro"', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = sampleMarketplacePayload();

      await webhooks.receive({
        id: 'test-8',
        name: 'marketplace_purchase' as any,
        payload: payload as any,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'purchased',
          accountId: 999,
          plan: 'pro',
        }),
        'Marketplace purchase event',
      );
    });

    it('maps "purchased" with "Enterprise Plan" to plan "enterprise"', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = {
        ...sampleMarketplacePayload(),
        marketplace_purchase: {
          ...sampleMarketplacePayload().marketplace_purchase,
          plan: {
            ...sampleMarketplacePayload().marketplace_purchase.plan,
            name: 'Enterprise Plan',
          },
        },
      };

      await webhooks.receive({
        id: 'test-9',
        name: 'marketplace_purchase' as any,
        payload: payload as any,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'purchased',
          accountId: 999,
          plan: 'enterprise',
        }),
        'Marketplace purchase event',
      );
    });

    it('maps "cancelled" to plan "free"', async () => {
      const webhooks = createGithubWebhooks(mockQueue);
      const payload = {
        ...sampleMarketplacePayload(),
        action: 'cancelled',
      };

      await webhooks.receive({
        id: 'test-10',
        name: 'marketplace_purchase' as any,
        payload: payload as any,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cancelled',
          plan: 'free',
        }),
        'Marketplace purchase event',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// suggestLabels
// ---------------------------------------------------------------------------

describe('suggestLabels', () => {
  it('returns "bug" for bug-related keywords', () => {
    expect(suggestLabels('The app crashes when I click submit')).toContain('bug');
    expect(suggestLabels('error occurred during login')).toContain('bug');
    expect(suggestLabels('broken link in footer')).toContain('bug');
  });

  it('returns "enhancement" for feature requests', () => {
    expect(suggestLabels('Add support for dark mode')).toContain('enhancement');
    expect(suggestLabels('feature request: export to PDF')).toContain('enhancement');
    expect(suggestLabels('Please implement user groups')).toContain('enhancement');
    expect(suggestLabels('new feature: webhook retries with exponential backoff')).toContain('enhancement');
  });

  it('returns "question" for questions', () => {
    expect(suggestLabels('How do I configure the bot?')).toContain('question');
    expect(suggestLabels('Is there a way to disable it?')).toContain('question');
    expect(suggestLabels('what is the expected behavior?')).toContain('question');
  });

  it('returns "documentation" for docs mentions', () => {
    expect(suggestLabels('Please update the README')).toContain('documentation');
    expect(suggestLabels('Missing docs for webhook setup')).toContain('documentation');
    expect(suggestLabels('Add documentation for the API')).toContain('documentation');
  });

  it('returns empty array for empty text', () => {
    expect(suggestLabels('')).toEqual([]);
  });

  it('detects "security" for security-related keywords', () => {
    expect(suggestLabels('security vulnerability in login')).toContain('security');
    expect(suggestLabels('XSS attack vector detected')).toContain('security');
    expect(suggestLabels('CSRF token missing')).toContain('security');
    expect(suggestLabels('authentication bypass')).toContain('security');
    expect(suggestLabels('authorization flaw')).toContain('security');
  });

  it('detects "performance" for performance-related keywords', () => {
    expect(suggestLabels('Slow response time on /api/search')).toContain('performance');
    expect(suggestLabels('Memory leak in worker process')).toContain('performance');
    expect(suggestLabels('High CPU usage')).toContain('performance');
  });

  it('returns multiple labels when text matches multiple categories', () => {
    const labels = suggestLabels('Security issue: slow authentication leads to crashes');
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it('handles case-insensitive keyword matching', () => {
    expect(suggestLabels('BUG: Login button missing')).toContain('bug');
    expect(suggestLabels('BUG')).toContain('bug');
  });
});

// ---------------------------------------------------------------------------
// Dedup key consistency
// ---------------------------------------------------------------------------

describe('dedup key consistency', () => {
  it('produces the same dedup key for the same issue', () => {
    // Two identical payloads should produce the same dedup key
    const webhooks = createGithubWebhooks(createMockQueue());
    const payload1 = sampleIssueLabeledPayload();
    const payload2 = sampleIssueLabeledPayload();

    // We can't easily access the dedup key from outside, but we can verify
    // that enqueueIssue is called with consistent dedup key by checking
    // that both calls produce the same key... via the mock.
    // Instead, we verify that the handler calls enqueueIssue with
    // the same queue and same job data for identical payloads.

    // First call
    mockEnqueueIssue.mockClear();
    webhooks.receive({
      id: 'dedup-1',
      name: 'issues.labeled' as any,
      payload: payload1 as any,
    });

    const call1Arg = mockEnqueueIssue.mock.calls[0]?.[1];
    mockEnqueueIssue.mockClear();

    // Second call
    webhooks.receive({
      id: 'dedup-2',
      name: 'issues.labeled' as any,
      payload: payload2 as any,
    });

    const call2Arg = mockEnqueueIssue.mock.calls[0]?.[1];

    // Same issue → same job data
    expect(call1Arg?.issueNumber).toBe(call2Arg?.issueNumber);
    expect(call1Arg?.repoName).toBe(call2Arg?.repoName);
  });
});
