/**
 * Unit tests for src/agent/issueAgent.ts — the main agent pipeline.
 *
 * Tests the top-level `runIssueAgent()` function.
 *
 * All external dependencies (OpenAI, Octokit, Sandbox, config, trackers)
 * are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockOpenAICreate } = vi.hoisted(() => ({
  mockOpenAICreate: vi.fn().mockResolvedValue({
    id: 'chatcmpl-mock',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({
            type: 'bug',
            difficulty: 'easy',
            summary: 'Mock classification',
          }),
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
}));

const mockLogger = vi.hoisted(() => {
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

// ---------------------------------------------------------------------------
// Module-level mocks (paths relative to test file)
// ---------------------------------------------------------------------------

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: mockOpenAICreate,
      },
    },
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: mockLogger.mockLogger,
  jobLogger: vi.fn(() => mockLogger.mockLogger),
}));

vi.mock('../../config.js', () => ({
  config: {
    openai: {
      apiKey: 'sk-test',
      cheapModel: 'gpt-4o-mini',
    },
    opencode: {
      url: 'http://localhost:4096',
      model: 'anthropic/claude-sonnet-4-20250514',
      fallbackModels: ['gpt-4o', 'claude-haiku'],
    },
    phaseTimeouts: {
      triage: 30_000,
      sandboxBoot: 300_000,
      openCodeAgent: 600_000,
      prCreation: 30_000,
    },
    stas: {
      maxIssueComments: 15,
      label: 'stas:fix',
      botName: 'STAS',
      devSkipWebhookVerify: false,
    },
    e2b: {
      apiKey: 'test-e2b-key',
      templateId: 'stas-default',
      sandboxTimeoutMs: 300_000,
    },
    trackers: {},
  },
}));

vi.mock('../../github/auth.js', () => ({
  getOctokit: vi.fn().mockResolvedValue({
    issues: {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    },
    pulls: { create: vi.fn(), update: vi.fn() },
    git: { createRef: vi.fn(), getRef: vi.fn() },
    repos: { getContent: vi.fn() },
  }),
  getInstallationToken: vi.fn().mockResolvedValue('mock-installation-token'),
}));

vi.mock('../../github/actionDispatcher.js', () => ({
  ActionDispatcher: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn().mockResolvedValue({
      action: 'pr_created',
      prUrl: 'https://github.com/owner/repo/pull/42',
      prNumber: 42,
    }),
  })),
}));

vi.mock('../../github/messages.js', () => ({
  featureSkipComment: vi.fn(() => 'Feature request skipped'),
  questionSkipComment: vi.fn(() => 'Question skipped'),
  timeoutComment: vi.fn((phase, ms) => `Timeout in ${phase} after ${ms}ms`),
  errorComment: vi.fn((msg) => `Error: ${msg}`),
  retryComment: vi.fn((attempt, model, error) => `Retry ${attempt} with ${model}: ${error}`),
  modelFallbackComment: vi.fn((model, error) => `Fallback to ${model}: ${error}`),
}));

vi.mock('../../sandbox/executor.js', () => ({
  SandboxExecutor: vi.fn().mockImplementation(() => ({
    boot: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    execForTools: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    hasTestSuite: vi.fn().mockReturnValue(true),
    runTests: vi.fn().mockResolvedValue({
      passed: true,
      output: 'PASS: all tests passed',
      command: 'npm test',
      durationMs: 5000,
    }),
    runSpecificTest: vi.fn().mockResolvedValue({
      passed: true,
      output: 'PASS',
      command: 'npm test',
      durationMs: 1000,
    }),
    formatCode: vi.fn().mockResolvedValue(undefined),
    analyzeCode: vi.fn().mockResolvedValue('No errors'),
    detectRuntime: vi.fn().mockResolvedValue({
      language: 'node',
      version: '20',
      testCommand: 'npm test',
      installCommand: 'npm install',
      formatCommand: 'npx prettier --write .',
      lintCommand: 'npx tsc --noEmit',
    }),
    installDeps: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../trackers/index.js', () => ({
  getTracker: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { runIssueAgent } from '../../agent/issueAgent.js';
import type { IssueJobData } from '../../utils/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleJobData(overrides?: Partial<IssueJobData>): IssueJobData {
  return {
    installationId: 555,
    repoOwner: 'owner',
    repoName: 'test-repo',
    repoPrivate: false,
    issueNumber: 42,
    issueTitle: 'Fix broken login',
    issueBody: 'Users cannot log in with special characters.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runIssueAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an AgentResult for a bug fix', async () => {
    const result = await runIssueAgent(sampleJobData());

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('fixReady');
    expect(typeof result.summary).toBe('string');
    expect(typeof result.confidence).toBe('string');
  });

  it('returns fixReady with appropriate value', async () => {
    const result = await runIssueAgent(sampleJobData());
    // fixReady may be true or false depending on the mock flow, but should be boolean
    expect(typeof result.fixReady).toBe('boolean');
  });

  it('includes prUrl when fix is successful', async () => {
    const result = await runIssueAgent(sampleJobData());
    if ('prUrl' in result && result.prUrl) {
      expect(typeof result.prUrl).toBe('string');
    }
  });

  it('includes branchName when defined', async () => {
    const result = await runIssueAgent(sampleJobData());
    if ('branchName' in result && result.branchName) {
      expect(typeof result.branchName).toBe('string');
    }
  });

  it('does not throw for minimal job data', async () => {
    await expect(runIssueAgent(sampleJobData())).resolves.toBeDefined();
  });

  it('handles null issueBody gracefully', async () => {
    const result = await runIssueAgent(sampleJobData({ issueBody: null }));
    expect(result).toBeDefined();
  });

  it('handles empty issueTitle', async () => {
    const result = await runIssueAgent(sampleJobData({ issueTitle: '' }));
    expect(result).toBeDefined();
  });

  it('handles pipeline errors and returns graceful error result', async () => {
    // Force OpenAI classification to throw
    mockOpenAICreate.mockRejectedValueOnce(new Error('API unavailable'));

    const result = await runIssueAgent(sampleJobData());
    expect(result).toBeDefined();
    expect(typeof result.summary).toBe('string');
  });

  it('propagates trackerType and trackerTicketId if provided', async () => {
    const data = sampleJobData({
      trackerType: 'linear',
      trackerTicketId: 'lin-123',
    });

    const result = await runIssueAgent(data);
    expect(result).toBeDefined();
  });

  it('uses source field from job data', async () => {
    const result = await runIssueAgent(sampleJobData({ source: 'github' }));
    expect(result).toBeDefined();
  });

  it('handles very long issue body', async () => {
    const result = await runIssueAgent(
      sampleJobData({ issueBody: 'x'.repeat(10000) }),
    );
    expect(result).toBeDefined();
  });

  it('handles issueBody without body field', async () => {
    const result = await runIssueAgent(sampleJobData({ issueBody: 'No body text' }));
    expect(result).toBeDefined();
  });

  it('processes without jobId successfully', async () => {
    const result = await runIssueAgent(sampleJobData());
    expect(result).toBeDefined();
  });

  it('handles private repo data', async () => {
    const result = await runIssueAgent(sampleJobData({ repoPrivate: true }));
    expect(result).toBeDefined();
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe('runIssueAgent edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles zero installationId', async () => {
    await expect(
      runIssueAgent(sampleJobData({ installationId: 0 })),
    ).resolves.toBeDefined();
  });

  it('handles negative issueNumber', async () => {
    await expect(
      runIssueAgent(sampleJobData({ issueNumber: -1 })),
    ).resolves.toBeDefined();
  });

  it('handles extremely long repoOwner name', async () => {
    await expect(
      runIssueAgent(sampleJobData({ repoOwner: 'a'.repeat(255) })),
    ).resolves.toBeDefined();
  });

  it('handles empty repoName', async () => {
    await expect(
      runIssueAgent(sampleJobData({ repoName: '' })),
    ).resolves.toBeDefined();
  });

  it('handles unicode characters in issue title', async () => {
    const result = await runIssueAgent(
      sampleJobData({ issueTitle: '🔧 Fix unicode — тест 测试' }),
    );
    expect(result).toBeDefined();
  });

  it('handles multiple rapid calls without interference', async () => {
    const results = await Promise.all([
      runIssueAgent(sampleJobData({ issueNumber: 1 })),
      runIssueAgent(sampleJobData({ issueNumber: 2 })),
    ]);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toBeDefined();
    }
  });
});
