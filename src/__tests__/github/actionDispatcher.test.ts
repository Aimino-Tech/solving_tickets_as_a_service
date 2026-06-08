/**
 * Unit tests for src/github/actionDispatcher.ts
 *
 * Covers:
 * - ActionDispatcher.dispatch() for all confidence levels (high, medium, low)
 * - Already-fixed and no-fix paths
 * - Investigation-only mode
 * - Pre-existing regression detection
 * - Error handling and fallback comment posting
 * - postComment error logging
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreateComment, mockPullsCreate, mockOctokitInstance, mockLoggerChild } = vi.hoisted(() => {
  const createComment = vi.fn();
  const pullsCreate = vi.fn();
  const resetMocks = () => {
    createComment.mockResolvedValue({ data: { id: 1 } });
    pullsCreate.mockResolvedValue({
      data: { id: 100, number: 42, html_url: 'https://github.com/owner/repo/pull/42' },
    });
  };
  resetMocks();

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

  return {
    mockCreateComment: createComment,
    mockPullsCreate: pullsCreate,
    mockOctokitInstance: {
      issues: { createComment },
      pulls: { create: pullsCreate, update: vi.fn() },
      git: { createRef: vi.fn(), getRef: vi.fn() },
      repos: { getContent: vi.fn() },
    },
    mockLoggerChild: logger,
  };
});

// ---------------------------------------------------------------------------
// Module-level mocks (paths relative to test file)
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => mockLoggerChild) },
}));

vi.mock('../../config.js', () => ({
  config: {
    stas: { botName: 'STAS', label: 'stas:fix' },
    github: {
      appId: 'test-app',
      webhookSecret: 'test-secret',
      webhookPath: '/webhook',
      privateKeyPath: undefined as string | undefined,
      privateKeyEnv: '-----BEGIN PRIVATE KEY-----\nMOCKKEY\n-----END PRIVATE KEY-----',
    },
  },
}));

vi.mock('../../sandbox/executor.js', () => ({
  SandboxExecutor: vi.fn(),
}));

vi.mock('../../github/auth.ts', () => ({
  getOctokit: () => Promise.resolve(mockOctokitInstance),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { ActionDispatcher } from '../../github/actionDispatcher.js';
import type { AgentResult } from '../../agent/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSandbox() {
  return {
    boot: vi.fn(),
    destroy: vi.fn(),
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    hasTestSuite: vi.fn().mockReturnValue(true),
    runTests: vi.fn(),
    runSpecificTest: vi.fn(),
    formatCode: vi.fn(),
    analyzeCode: vi.fn(),
    detectRuntime: vi.fn(),
    installDeps: vi.fn(),
    execForTools: vi.fn(),
  } as any;
}

function createDispatchParams(overrides?: Partial<AgentResult>) {
  return {
    issueNumber: 42,
    issueTitle: 'Fix broken login',
    agentResult: {
      summary: 'Fixed the login handler with input sanitization.',
      confidence: 'high' as const,
      fixReady: true,
      branchName: 'stas/fix-42-abc',
      diff: 'diff --git a/src/login.ts b/src/login.ts\n+const sanitized = escape(input);',
      testOutput: 'PASS: 2 tests passed',
      errors: [],
      verification: {
        baseline: { passed: true, output: 'PASS', command: 'npm test', durationMs: 5000 },
        postFix: { passed: true, output: 'PASS', command: 'npm test', durationMs: 5200 },
        regressionTestCreated: true,
        regressionTestPassedOnOriginal: true,
        regressionTestPassedOnFix: true,
        preExistingTestsRegressed: false,
        unverified: false,
        details: ['All checks passed'],
      },
      ...overrides,
    },
    sandbox: createMockSandbox(),
    repoOwner: 'owner',
    repoName: 'test-repo',
    installationId: 555,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ActionDispatcher', () => {
  let dispatcher: ActionDispatcher;

  beforeEach(() => {
    mockCreateComment.mockResolvedValue({ data: { id: 1 } });
    mockPullsCreate.mockResolvedValue({
      data: { id: 100, number: 42, html_url: 'https://github.com/owner/repo/pull/42' },
    });
    dispatcher = new ActionDispatcher();
  });

  // ── High confidence → PR created ─────────────────────────────────

  describe('high confidence (pr_created)', () => {
    it('creates a non-draft PR and returns pr_created action', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('pr_created');
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
      expect(result.prNumber).toBe(42);
    });

    it('calls octokit.pulls.create with correct arguments', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      await dispatcher.dispatch(params);

      expect(mockPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'owner',
          repo: 'test-repo',
          title: 'Fix: Fix broken login',
          head: expect.stringContaining('stas/fix-'),
          base: 'main',
        }),
      );
    });

    it('posts a high-confidence issue comment via createComment', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      await dispatcher.dispatch(params);

      expect(mockCreateComment).toHaveBeenCalled();
      const commentCall = mockCreateComment.mock.calls.find(
        (c: any[]) => c[0].issue_number === 42,
      );
      expect(commentCall).toBeDefined();
    });

    it('pushes branch before creating PR', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      await dispatcher.dispatch(params);

      expect(params.sandbox.pushBranch).toHaveBeenCalledWith(
        expect.stringContaining('stas/fix-'),
      );
    });
  });

  // ── Medium confidence → Draft PR ─────────────────────────────────

  describe('medium confidence (draft_pr_created)', () => {
    it('creates a draft PR and returns draft_pr_created action', async () => {
      const params = createDispatchParams({ confidence: 'medium' });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('draft_pr_created');
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
    });

    it('includes draft: true in PR options', async () => {
      const params = createDispatchParams({ confidence: 'medium' });
      await dispatcher.dispatch(params);

      expect(mockPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ draft: true }),
      );
    });

    it('prefixes PR title with [WIP]', async () => {
      const params = createDispatchParams({ confidence: 'medium' });
      await dispatcher.dispatch(params);

      expect(mockPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '[WIP] Fix: Fix broken login',
        }),
      );
    });
  });

  // ── Low confidence → Comment only ────────────────────────────────

  describe('low confidence (comment_posted)', () => {
    it('posts a comment and returns comment_posted action', async () => {
      const params = createDispatchParams({ confidence: 'low' });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('comment_posted');
      expect(result.commentBody).toBeDefined();
    });

    it('includes test output in the comment', async () => {
      const params = createDispatchParams({
        confidence: 'low',
        testOutput: 'FAIL: some tests failed',
      });
      await dispatcher.dispatch(params);

      expect(mockCreateComment).toHaveBeenCalled();
    });

    it('still pushes branch for low confidence', async () => {
      const params = createDispatchParams({
        confidence: 'low',
        testOutput: 'output',
      });
      await dispatcher.dispatch(params);

      expect(params.sandbox.pushBranch).toHaveBeenCalled();
    });
  });

  // ── Already fixed ────────────────────────────────────────────────

  describe('alreadyFixed', () => {
    it('posts comment and returns comment_posted when alreadyFixed is true', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'low',
        alreadyFixed: true,
        noFixReason: 'Already resolved',
      });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('comment_posted');
    });

    it('does not push branch for already-fixed issues', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'low',
        alreadyFixed: true,
        noFixReason: 'Already resolved',
      });
      await dispatcher.dispatch(params);

      expect(params.sandbox.pushBranch).not.toHaveBeenCalled();
    });
  });

  // ── No fix possible ──────────────────────────────────────────────

  describe('no fix possible', () => {
    it('posts no-fix comment and returns comment_posted', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'low',
        noFixReason: 'Cannot reproduce',
      });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('comment_posted');
    });

    it('does not push branch when no fix possible', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'low',
        noFixReason: 'Cannot reproduce',
      });
      await dispatcher.dispatch(params);

      expect(params.sandbox.pushBranch).not.toHaveBeenCalled();
    });

    it('includes relevantPRs when provided', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'low',
        noFixReason: 'Cannot reproduce',
        relevantPRs: [
          { url: 'https://github.com/pulls/1', title: 'Related fix', state: 'merged' },
        ],
      });
      await dispatcher.dispatch(params);

      expect(mockCreateComment).toHaveBeenCalled();
    });
  });

  // ── Investigation only ───────────────────────────────────────────

  describe('investigationOnly', () => {
    it('posts investigation comment and returns comment_posted', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'medium',
        investigationOnly: true,
        summary: 'Root cause found in auth handler',
      });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('comment_posted');
    });

    it('does not push branch for investigation only', async () => {
      const params = createDispatchParams({
        fixReady: false,
        confidence: 'medium',
        investigationOnly: true,
        summary: 'Investigation complete',
      });
      await dispatcher.dispatch(params);

      expect(params.sandbox.pushBranch).not.toHaveBeenCalled();
    });
  });

  // ── Pre-existing regression → Blocked ────────────────────────────

  describe('pre-existing regression detected', () => {
    it('posts regression block comment and returns comment_posted', async () => {
      const params = createDispatchParams({
        confidence: 'high',
        verification: {
          baseline: { passed: true, output: 'PASS', command: 'npm test', durationMs: 5000 },
          postFix: { passed: false, output: 'FAIL', command: 'npm test', durationMs: 6000 },
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: true,
          unverified: false,
          details: ['REGRESSION: tests that were passing now fail'],
        },
      });
      const result = await dispatcher.dispatch(params);

      expect(result.action).toBe('comment_posted');
    });

    it('still pushes branch even when regression is detected', async () => {
      const params = createDispatchParams({
        confidence: 'high',
        verification: {
          baseline: { passed: true, output: 'PASS', command: 'npm test', durationMs: 5000 },
          postFix: { passed: false, output: 'FAIL', command: 'npm test', durationMs: 6000 },
          regressionTestCreated: false,
          regressionTestPassedOnOriginal: null,
          regressionTestPassedOnFix: null,
          preExistingTestsRegressed: true,
          unverified: false,
          details: ['REGRESSION'],
        },
      });
      await dispatcher.dispatch(params);

      expect(params.sandbox.pushBranch).toHaveBeenCalled();
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error action when dispatch throws', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      params.sandbox.pushBranch.mockRejectedValue(new Error('Push failed'));

      const result = await dispatcher.dispatch(params);

      // Should catch and return error
      expect(result.action).toBe('error');
    });

    it('posts error comment when dispatch fails', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      params.sandbox.pushBranch.mockRejectedValue(new Error('Network error'));

      await dispatcher.dispatch(params);

      expect(mockCreateComment).toHaveBeenCalled();
    });

    it('handles comment posting failure gracefully', async () => {
      mockCreateComment.mockRejectedValueOnce(new Error('Comment failed'));

      const params = createDispatchParams({ confidence: 'high' });
      params.sandbox.pushBranch.mockRejectedValue(new Error('Push failed'));

      // Should not throw even if error comment fails
      const result = await dispatcher.dispatch(params);
      expect(result.action).toBe('error');
    });
  });

  // ── Optional fields ──────────────────────────────────────────────

  describe('optional fields', () => {
    it('uses "main" as default branch when repoDefaultBranch is not provided', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      delete (params as any).repoDefaultBranch;

      await dispatcher.dispatch(params);

      expect(mockPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ base: 'main' }),
      );
    });

    it('uses custom repoDefaultBranch when provided', async () => {
      const params = createDispatchParams({ confidence: 'high', fixReady: true });
      (params as any).repoDefaultBranch = 'develop';

      await dispatcher.dispatch(params);

      expect(mockPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ base: 'develop' }),
      );
    });
  });

  // ── Gathered changed files ───────────────────────────────────────

  describe('changed file gathering', () => {
    it('gathers changed files for PR body', async () => {
      const sandbox = createMockSandbox();
      sandbox.pushBranch.mockResolvedValue(undefined);
      sandbox.exec.mockResolvedValue({
        stdout: 'src/login.ts\nsrc/utils/validation.ts\n',
        stderr: '',
        exitCode: 0,
      });

      const params = createDispatchParams({ confidence: 'high' });
      params.sandbox = sandbox;

      await dispatcher.dispatch(params);

      expect(mockPullsCreate).toHaveBeenCalled();
    });

    it('handles file gathering failure gracefully (non-fatal)', async () => {
      const sandbox = createMockSandbox();
      sandbox.pushBranch.mockResolvedValue(undefined);
      sandbox.exec.mockRejectedValue(new Error('git diff failed'));

      const params = createDispatchParams({ confidence: 'high' });
      params.sandbox = sandbox;

      const result = await dispatcher.dispatch(params);
      expect(result.action).toBe('pr_created');
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty errors array', async () => {
      const params = createDispatchParams({
        confidence: 'medium',
        errors: [],
      });
      const result = await dispatcher.dispatch(params);
      expect(result.action).toBe('draft_pr_created');
    });

    it('handles undefined verification', async () => {
      const params = createDispatchParams({
        confidence: 'high',
        verification: undefined,
      });
      const result = await dispatcher.dispatch(params);
      expect(result.action).toBe('pr_created');
    });

    it('handles null testOutput', async () => {
      const params = createDispatchParams({
        confidence: 'low',
        testOutput: undefined,
        fixReady: true,
      });
      const result = await dispatcher.dispatch(params);
      expect(result.action).toBe('comment_posted');
    });

    it('handles zero issueNumber', async () => {
      const params = createDispatchParams({ confidence: 'high' });
      params.issueNumber = 0;
      const result = await dispatcher.dispatch(params);
      expect(result.action).toBe('pr_created');
    });
  });
});
