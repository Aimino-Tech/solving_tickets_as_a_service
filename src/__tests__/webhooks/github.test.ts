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
    github: { webhookSecret: 'test-secret' },
    stas: {
      label: 'stas:fix',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 30,
      rateLimitPerRepoMax: 5,
      rateLimitPerIpMax: 30,
      rateLimitPerUserMax: 10,
    },
    governance: {
      enabled: false,
      url: 'http://llm-governance:4002',
      timeoutMs: 10_000,
    },
    proxy: { dispatchUrl: '' },
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createGithubWebhooks, suggestLabels } from '../../webhooks/github.js';
import { sampleIssueLabeledPayload, sampleIssueOpenedPayload, sampleMarketplacePayload } from '../fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockEnqueue = vi.fn<(...args: unknown[]) => Promise<string | undefined>>().mockResolvedValue('job-mock-id');

// ---------------------------------------------------------------------------
// createGithubWebhooks
// ---------------------------------------------------------------------------

describe('createGithubWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockClear();
    mockEnqueue.mockResolvedValue('job-mock-id');
  });

  describe('issues.labeled' as any, () => {
    it('enqueues a job when label is the target label (stas:fix)', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = sampleIssueLabeledPayload();

      await webhooks.receive({
        id: 'test-1',
        name: 'issues.labeled' as any,
        payload: payload as any,
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          installationId: 555,
          repoOwner: 'owner',
          repoName: 'test-repo',
          issueNumber: 42,
          issueTitle: 'Fix broken user login',
          issueBody: 'Users are unable to log in when the password contains special characters.',
          labels: ['stas:fix'],
        }),
      );
    });

    it('does NOT enqueue when label is NOT the target label', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = sampleIssueLabeledPayload();
      payload.label = { name: 'other-label', color: 'ffffff', default: false, description: 'Some other label' };

      await webhooks.receive({
        id: 'test-2',
        name: 'issues.labeled' as any,
        payload: payload as any,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('does NOT enqueue when installation ID is missing', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = sampleIssueLabeledPayload();
      // Remove installation to simulate missing ID
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { installation: _, ...payloadWithoutInstallation } = payload as any;

      await webhooks.receive({
        id: 'test-3',
        name: 'issues.labeled' as any,
        payload: payloadWithoutInstallation as any,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
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
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = sampleIssueOpenedPayload();

      await webhooks.receive({
        id: 'test-4',
        name: 'issues.opened' as any,
        payload: payload as any,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('issues.edited' as any, () => {
    it('enqueues a job when the issue already has the target label', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
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

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(
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
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = sampleIssueOpenedPayload();

      await webhooks.receive({
        id: 'test-6',
        name: 'issues.edited' as any,
        payload: { ...payload, action: 'edited' } as any,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('does NOT enqueue when the issue has target label but no installation ID', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
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

      expect(mockEnqueue).not.toHaveBeenCalled();
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
      const webhooks = createGithubWebhooks(mockEnqueue);
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
      const webhooks = createGithubWebhooks(mockEnqueue);
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

    it('maps "cancelled" with non-pro/non-enterprise plan to plan "free"', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = {
        ...sampleMarketplacePayload(),
        action: 'cancelled',
        marketplace_purchase: {
          ...sampleMarketplacePayload().marketplace_purchase,
          plan: {
            ...sampleMarketplacePayload().marketplace_purchase.plan,
            name: 'Free Plan',
          },
        },
      };

      await webhooks.receive({
        id: 'test-10',
        name: 'marketplace_purchase' as any,
        payload: payload as any,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cancelled',
          accountId: 999,
          plan: 'free',
        }),
        'Marketplace purchase event',
      );
    });

    it('handles unexpected plan names gracefully (falls back to free)', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = {
        ...sampleMarketplacePayload(),
        marketplace_purchase: {
          ...sampleMarketplacePayload().marketplace_purchase,
          plan: {
            ...sampleMarketplacePayload().marketplace_purchase.plan,
            name: 'Platinum Plan',
          },
        },
      };

      await webhooks.receive({
        id: 'test-11',
        name: 'marketplace_purchase' as any,
        payload: payload as any,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
        }),
        'Marketplace purchase event',
      );
    });
  });

  describe('dedup consistency', () => {
    it('produces the same enqueue call for the same issue received twice', async () => {
      const webhooks = createGithubWebhooks(mockEnqueue);
      const payload = sampleIssueLabeledPayload();

      // First trigger
      await webhooks.receive({
        id: 'test-12',
        name: 'issues.labeled' as any,
        payload: payload as any,
      });

      // Second trigger — same issue
      await webhooks.receive({
        id: 'test-13',
        name: 'issues.labeled' as any,
        payload: payload as any,
      });

      // enqueueIssue should have been called twice (dedup happens inside BullMQ)
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ installationId: 555, repoOwner: 'owner', repoName: 'test-repo', issueNumber: 42 }),
      );
      expect(mockEnqueue).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ installationId: 555, repoOwner: 'owner', repoName: 'test-repo', issueNumber: 42 }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// suggestLabels
// ---------------------------------------------------------------------------

describe('suggestLabels', () => {
  describe('bug patterns', () => {
    it('includes "bug" when title/text contains "bug"', () => {
      expect(suggestLabels('bug in login', '')).toContain('bug');
    });

    it('includes "bug" when text contains "crash"', () => {
      expect(suggestLabels('app crash on startup', '')).toContain('bug');
    });

    it('includes "bug" when text contains "error"', () => {
      expect(suggestLabels('authentication error', '')).toContain('bug');
    });

    it('includes "bug" when text contains "broken"', () => {
      expect(suggestLabels('broken navigation', '')).toContain('bug');
    });

    it('includes "bug" when text contains "fails"', () => {
      expect(suggestLabels('build fails on CI', '')).toContain('bug');
    });

    it('includes "bug" when text contains "failure"', () => {
      expect(suggestLabels('test failure', '')).toContain('bug');
    });

    it('includes "bug" when text contains "incorrect"', () => {
      expect(suggestLabels('incorrect error message', '')).toContain('bug');
    });

    it('includes "bug" when text contains "wrong"', () => {
      expect(suggestLabels('wrong calculation', '')).toContain('bug');
    });

    it('includes "bug" when text contains "issue"', () => {
      expect(suggestLabels('performance issue', '')).toContain('bug');
    });

    it('includes "bug" when text contains "problem"', () => {
      expect(suggestLabels('memory leak problem', '')).toContain('bug');
    });

    it('includes "bug" when text contains "fix"', () => {
      expect(suggestLabels('fix the timeout', '')).toContain('bug');
    });
  });

  describe('feature patterns', () => {
    it('includes "enhancement" when title/text contains "feature"', () => {
      expect(suggestLabels('new feature: dark mode', '')).toContain('enhancement');
    });

    it('includes "enhancement" when text contains "request"', () => {
      expect(suggestLabels('feature request', '')).toContain('enhancement');
    });

    it('includes "enhancement" when text contains "please add"', () => {
      expect(suggestLabels('please add export', '')).toContain('enhancement');
    });

    it('includes "enhancement" when text contains "suggestion"', () => {
      expect(suggestLabels('suggestion: improve UX', '')).toContain('enhancement');
    });

    it('includes "enhancement" when text contains "idea"', () => {
      expect(suggestLabels('cool idea for v2', '')).toContain('enhancement');
    });

    it('includes "enhancement" when text contains "enhancement"', () => {
      expect(suggestLabels('minor enhancement', '')).toContain('enhancement');
    });
  });

  describe('documentation patterns', () => {
    it('includes "documentation" when text contains "docs"', () => {
      expect(suggestLabels('update docs', '')).toContain('documentation');
    });

    it('includes "documentation" when text contains "documentation"', () => {
      expect(suggestLabels('fix documentation', '')).toContain('documentation');
    });

    it('includes "documentation" when text contains "readme"', () => {
      expect(suggestLabels('improve readme', '')).toContain('documentation');
    });

    it('includes "documentation" when text contains "typo"', () => {
      expect(suggestLabels('fix typo', '')).toContain('documentation');
    });

    it('includes "documentation" when text contains "spelling"', () => {
      expect(suggestLabels('correct spelling', '')).toContain('documentation');
    });
  });

  describe('performance patterns', () => {
    it('includes "performance" when text contains "slow"', () => {
      expect(suggestLabels('slow page load', '')).toContain('performance');
    });

    it('includes "performance" when text contains "performance"', () => {
      expect(suggestLabels('improve performance', '')).toContain('performance');
    });

    it('includes "performance" when text contains "latency"', () => {
      expect(suggestLabels('reduce latency', '')).toContain('performance');
    });

    it('includes "performance" when text contains "memory"', () => {
      expect(suggestLabels('memory consumption', '')).toContain('performance');
    });

    it('includes "performance" when text contains "leak"', () => {
      expect(suggestLabels('memory leak', '')).toContain('performance');
    });

    it('includes "performance" when text contains "optimize"', () => {
      expect(suggestLabels('optimize query', '')).toContain('performance');
    });

    it('includes "performance" when text contains "bottleneck"', () => {
      expect(suggestLabels('remove bottleneck', '')).toContain('performance');
    });
  });

  describe('question patterns', () => {
    it('includes "question" when text contains "how to"', () => {
      expect(suggestLabels('how to deploy', '')).toContain('question');
    });

    it('includes "question" when text contains "how do i"', () => {
      expect(suggestLabels('how do i configure', '')).toContain('question');
    });

    it('includes "question" when text contains "question"', () => {
      expect(suggestLabels('quick question', '')).toContain('question');
    });

    it('includes "question" when text contains "help"', () => {
      expect(suggestLabels('help with setup', '')).toContain('question');
    });

    it('includes "question" when text contains "guide"', () => {
      expect(suggestLabels('setup guide', '')).toContain('question');
    });
  });

  describe('non-matching keywords', () => {
    it('returns empty array when no patterns match', () => {
      expect(suggestLabels('refactoring code', '')).toEqual([]);
    });

    it('returns empty array for unrelated text', () => {
      expect(suggestLabels('refactor the codebase', '')).toEqual([]);
    });

    it('returns empty array for test-related text (no pattern exists)', () => {
      expect(suggestLabels('improve test coverage', '')).toEqual([]);
    });

    it('returns empty array for cleanup text (no pattern exists)', () => {
      expect(suggestLabels('cleanup this module', '')).toEqual([]);
    });
  });

  describe('empty / edge input', () => {
    it('returns empty array for empty title and body', () => {
      expect(suggestLabels('', '')).toEqual([]);
    });

    it('returns empty array for whitespace-only text', () => {
      expect(suggestLabels('   ', '\n  \n')).toEqual([]);
    });
  });

  describe('multi-label detection', () => {
    it('returns multiple labels when multiple patterns match', () => {
      const result = suggestLabels('bug: memory leak in docs', '');
      expect(result).toContain('bug');
      expect(result).toContain('documentation');
      expect(result).toContain('performance');
    });

    it('includes both bug and feature when both match', () => {
      const result = suggestLabels('fix slow feature request', '');
      expect(result).toContain('bug');
      expect(result).toContain('enhancement');
      expect(result).toContain('performance');
    });
  });

  describe('body text matching', () => {
    it('scans the body text (not just title)', () => {
      expect(suggestLabels('Nice title', 'The app crashes when I click submit')).toContain('bug');
    });
  });
});
