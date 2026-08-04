/**
 * Unit tests for src/github/prQualityGate.ts
 *
 * Covers:
 * - handlePullRequestOpened for SYNTARO and non-SYNTARO PRs
 * - requestReviewFromCollaborators selection and dedupe
 * - handleCheckSuiteCompleted success/failure gate comments
 * - enableMergeQueue gating on PR_MERGE_QUEUE_ENABLED
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockOctokitInstance, mockLoggerChild, mockConfig, resetMocks } = vi.hoisted(() => {
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

  const syntaroPr = {
    data: {
      number: 42,
      title: 'Fix: broken login',
      body: 'Powered by Syntaro — AI bug fixes for your repo',
      state: 'open',
      merged: false,
      node_id: 'PR_node_42',
      user: { login: 'syntaro-bot' },
      head: { sha: 'abc123', repo: { owner: { login: 'syntaro-bot' } } },
    },
  };

  const collaborators = {
    data: [
      { login: 'alice', permissions: { push: true } },
      { login: 'bob', permissions: { push: true } },
      { login: 'carol', permissions: { push: false } },
    ],
  };

  const octokit = {
    pulls: {
      get: vi.fn().mockResolvedValue(syntaroPr),
      listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
      requestReviewers: vi.fn().mockResolvedValue({}),
    },
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    },
    repos: {
      listCollaborators: vi.fn().mockResolvedValue(collaborators),
    },
    graphql: vi.fn().mockResolvedValue({}),
  };

  function resetMocks() {
    octokit.pulls.get.mockReset();
    octokit.pulls.get.mockResolvedValue(syntaroPr);
    octokit.pulls.listReviewComments.mockReset();
    octokit.pulls.listReviewComments.mockResolvedValue({ data: [] });
    octokit.pulls.requestReviewers.mockReset();
    octokit.pulls.requestReviewers.mockResolvedValue({});
    octokit.issues.createComment.mockReset();
    octokit.issues.createComment.mockResolvedValue({ data: { id: 1 } });
    octokit.repos.listCollaborators.mockReset();
    octokit.repos.listCollaborators.mockResolvedValue(collaborators);
    octokit.graphql.mockReset();
    octokit.graphql.mockResolvedValue({});
  }

  return {
    mockConfig: {
      github: {
        autoRequestReview: true,
        reviewersCount: 2,
        prQualityGate: true,
        mergeQueueEnabled: true,
      },
      syntaro: { label: 'syntaro:fix' },
    },
    mockOctokitInstance: octokit,
    mockLoggerChild: logger,
    resetMocks,
  };
});

// ---------------------------------------------------------------------------
// Module-level mocks (paths relative to test file)
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => mockLoggerChild) },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import {
  handleCheckSuiteCompleted,
  handlePullRequestOpened,
  requestReviewFromCollaborators,
} from '../../github/prQualityGate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prOpenedPayload(overrides?: Record<string, unknown>) {
  return {
    action: 'opened',
    number: 42,
    pull_request: {
      number: 42,
      html_url: 'https://github.com/owner/test-repo/pull/42',
      user: { login: 'syntaro-bot' },
      head: { sha: 'abc123' },
      base: { ref: 'main' },
    },
    repository: { owner: { login: 'owner' }, name: 'test-repo' },
    installation: { id: 555 },
    ...overrides,
  };
}

function checkSuiteCompletedPayload(overrides?: Record<string, unknown>) {
  return {
    action: 'completed',
    check_suite: {
      status: 'completed',
      conclusion: 'success',
      head_sha: 'abc123',
      pull_requests: [{ number: 42 }],
    },
    repository: { owner: { login: 'owner' }, name: 'test-repo' },
    installation: { id: 555 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const defaultConfig = {
  github: {
    autoRequestReview: true,
    reviewersCount: 2,
    prQualityGate: true,
    mergeQueueEnabled: true,
  },
  syntaro: { label: 'syntaro:fix' },
};

describe('prQualityGate', () => {
  beforeEach(() => {
    resetMocks();
    Object.assign(mockConfig.github, defaultConfig.github);
    Object.assign(mockConfig.syntaro, defaultConfig.syntaro);
  });

  describe('handlePullRequestOpened', () => {
    it('does nothing for non-opened actions', async () => {
      await handlePullRequestOpened(mockOctokitInstance as never, prOpenedPayload({ action: 'edited' }) as never);

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
      expect(mockOctokitInstance.pulls.requestReviewers).not.toHaveBeenCalled();
    });

    it('does nothing for a non-SYNTARO PR', async () => {
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          body: 'a human-authored PR',
          state: 'open',
          user: { login: 'human' },
          head: { repo: { owner: { login: 'another-org' } } },
        },
      });

      await handlePullRequestOpened(mockOctokitInstance as never, prOpenedPayload() as never);

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
      expect(mockOctokitInstance.pulls.requestReviewers).not.toHaveBeenCalled();
    });

    it('posts the waiting-for-CI comment and requests review for a SYNTARO PR', async () => {
      await handlePullRequestOpened(mockOctokitInstance as never, prOpenedPayload() as never);

      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'owner',
          repo: 'test-repo',
          issue_number: 42,
          body: expect.stringContaining('waiting for CI checks'),
        }),
      );
      expect(mockOctokitInstance.pulls.requestReviewers).toHaveBeenCalledWith(
        expect.objectContaining({ reviewers: ['alice', 'bob'] }),
      );
    });

    it('skips the waiting comment when prQualityGate is disabled', async () => {
      mockConfig.github.prQualityGate = false;

      await handlePullRequestOpened(mockOctokitInstance as never, prOpenedPayload() as never);

      const waitingComment = mockOctokitInstance.issues.createComment.mock.calls.find((c: any[]) =>
        c[0]?.body?.includes?.('waiting for CI checks'),
      );
      expect(waitingComment).toBeUndefined();
      expect(mockOctokitInstance.pulls.requestReviewers).toHaveBeenCalled();
    });

    it('still requests review when prQualityGate is disabled', async () => {
      mockConfig.github.prQualityGate = false;

      await handlePullRequestOpened(mockOctokitInstance as never, prOpenedPayload() as never);

      expect(mockOctokitInstance.pulls.requestReviewers).toHaveBeenCalled();
    });
  });

  describe('requestReviewFromCollaborators', () => {
    it('does nothing when autoRequestReview is disabled', async () => {
      mockConfig.github.autoRequestReview = false;

      await requestReviewFromCollaborators(mockOctokitInstance as never, 'owner', 'test-repo', 42);

      expect(mockOctokitInstance.repos.listCollaborators).not.toHaveBeenCalled();
      expect(mockOctokitInstance.pulls.requestReviewers).not.toHaveBeenCalled();
    });

    it('filters out the author and non-push collaborators', async () => {
      mockOctokitInstance.repos.listCollaborators.mockResolvedValue({
        data: [
          { login: 'alice', permissions: { push: true } },
          { login: 'syntaro-bot', permissions: { push: true } },
          { login: 'carol', permissions: { push: false } },
          { login: 'readonly', permissions: { pull: true } },
        ],
      });

      await requestReviewFromCollaborators(mockOctokitInstance as never, 'owner', 'test-repo', 42, 'syntaro-bot');

      expect(mockOctokitInstance.pulls.requestReviewers).toHaveBeenCalledWith(
        expect.objectContaining({ reviewers: ['alice'] }),
      );
    });

    it('skips requesting when no eligible collaborators exist', async () => {
      mockOctokitInstance.repos.listCollaborators.mockResolvedValue({
        data: [{ login: 'syntaro-bot', permissions: { push: true } }],
      });

      await requestReviewFromCollaborators(mockOctokitInstance as never, 'owner', 'test-repo', 42, 'syntaro-bot');

      expect(mockOctokitInstance.pulls.requestReviewers).not.toHaveBeenCalled();
      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('does not re-request when a review comment already exists', async () => {
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [{ body: '🔄 **Syntaro** Requested review from: @alice' }],
      });

      await requestReviewFromCollaborators(mockOctokitInstance as never, 'owner', 'test-repo', 42);

      expect(mockOctokitInstance.pulls.requestReviewers).not.toHaveBeenCalled();
    });

    it('posts a review-requested comment after requesting reviewers', async () => {
      await requestReviewFromCollaborators(mockOctokitInstance as never, 'owner', 'test-repo', 42);

      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: '🔄 **Syntaro** requested review from: @alice, @bob',
        }),
      );
    });

    it('does not throw when the GitHub API fails', async () => {
      mockOctokitInstance.repos.listCollaborators.mockRejectedValue(new Error('api down'));

      await expect(
        requestReviewFromCollaborators(mockOctokitInstance as never, 'owner', 'test-repo', 42),
      ).resolves.toBeUndefined();
      expect(mockLoggerChild.warn).toHaveBeenCalled();
    });
  });

  describe('handleCheckSuiteCompleted', () => {
    it('does nothing when check_suite is missing', async () => {
      await handleCheckSuiteCompleted(
        mockOctokitInstance as never,
        checkSuiteCompletedPayload({ check_suite: undefined }) as never,
      );

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('does nothing for non-completed actions', async () => {
      await handleCheckSuiteCompleted(
        mockOctokitInstance as never,
        checkSuiteCompletedPayload({ action: 'requested' }) as never,
      );

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('does nothing when the suite has no pull requests', async () => {
      await handleCheckSuiteCompleted(
        mockOctokitInstance as never,
        checkSuiteCompletedPayload({
          check_suite: { status: 'completed', conclusion: 'success', head_sha: 'abc', pull_requests: [] },
        }) as never,
      );

      expect(mockOctokitInstance.pulls.get).not.toHaveBeenCalled();
    });

    it('skips non-SYNTARO PRs', async () => {
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          body: 'human PR',
          state: 'open',
          merged: false,
          user: { login: 'human' },
          head: { repo: { owner: { login: 'another-org' } } },
        },
      });

      await handleCheckSuiteCompleted(mockOctokitInstance as never, checkSuiteCompletedPayload() as never);

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('skips merged or closed PRs', async () => {
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          body: 'Powered by Syntaro',
          state: 'merged',
          merged: true,
          user: { login: 'syntaro-bot' },
          head: { repo: { owner: { login: 'syntaro-bot' } } },
        },
      });

      await handleCheckSuiteCompleted(mockOctokitInstance as never, checkSuiteCompletedPayload() as never);

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('posts a passed comment and enables merge queue on success', async () => {
      await handleCheckSuiteCompleted(mockOctokitInstance as never, checkSuiteCompletedPayload() as never);

      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('quality gate passed'),
        }),
      );
      expect(mockOctokitInstance.graphql).toHaveBeenCalledWith(
        expect.stringContaining('enablePullRequestAutoMerge'),
        expect.objectContaining({ prId: 'PR_node_42' }),
      );
    });

    it('does not post a duplicate passed comment', async () => {
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [{ body: '✅ **Syntaro quality gate passed** — all CI checks are green.' }],
      });

      await handleCheckSuiteCompleted(mockOctokitInstance as never, checkSuiteCompletedPayload() as never);

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('posts a failed comment on non-success conclusion', async () => {
      await handleCheckSuiteCompleted(
        mockOctokitInstance as never,
        checkSuiteCompletedPayload({
          check_suite: { status: 'completed', conclusion: 'failure', head_sha: 'abc', pull_requests: [{ number: 42 }] },
        }) as never,
      );

      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('quality gate failed'),
        }),
      );
      expect(mockOctokitInstance.graphql).not.toHaveBeenCalled();
    });

    it('does not post a duplicate failed comment', async () => {
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [{ body: '❌ **Syntaro quality gate failed** — CI check suite concluded with `failure`.' }],
      });

      await handleCheckSuiteCompleted(
        mockOctokitInstance as never,
        checkSuiteCompletedPayload({
          check_suite: { status: 'completed', conclusion: 'failure', head_sha: 'abc', pull_requests: [{ number: 42 }] },
        }) as never,
      );

      expect(mockOctokitInstance.issues.createComment).not.toHaveBeenCalled();
    });

    it('does not enable merge queue when PR_MERGE_QUEUE_ENABLED is false', async () => {
      mockConfig.github.mergeQueueEnabled = false;

      await handleCheckSuiteCompleted(mockOctokitInstance as never, checkSuiteCompletedPayload() as never);

      expect(mockOctokitInstance.graphql).not.toHaveBeenCalled();
      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('quality gate passed') }),
      );
    });

    it('continues to the next PR when one PR lookup fails', async () => {
      mockOctokitInstance.pulls.get.mockResolvedValueOnce({
        data: {
          body: 'Powered by Syntaro',
          state: 'open',
          merged: false,
          user: { login: 'syntaro-bot' },
          head: { repo: { owner: { login: 'syntaro-bot' } } },
        },
      });
      mockOctokitInstance.pulls.listReviewComments.mockRejectedValueOnce(new Error('comments failed'));

      await expect(
        handleCheckSuiteCompleted(
          mockOctokitInstance as never,
          checkSuiteCompletedPayload({
            check_suite: {
              status: 'completed',
              conclusion: 'success',
              head_sha: 'abc',
              pull_requests: [{ number: 42 }, { number: 43 }],
            },
          }) as never,
        ),
      ).resolves.toBeUndefined();
      expect(mockLoggerChild.warn).toHaveBeenCalled();
    });
  });
});
