/**
 * Benchmark test setup — provides mock factories for all pipeline phases.
 *
 * Each factory returns lightweight, synchronous mocks that simulate real
 * behavior without external dependencies (no network, no Redis, no E2B).
 */

import { vi } from 'vitest';

// ── Mock Webhook Payload ─────────────────────────────────────────────

export interface MockWebhookPayload {
  event: string;
  deliveryId: string;
  signature: string;
  rawBody: Buffer;
  parsed: Record<string, unknown>;
}

export function createMockWebhookPayload(): MockWebhookPayload {
  return {
    event: 'issues.labeled',
    deliveryId: 'delivery-12345',
    signature: 'sha256=abc123def456',
    rawBody: Buffer.from(
      JSON.stringify({
        action: 'labeled',
        issue: {
          number: 42,
          title: 'Fix broken user login',
          body: 'Users are unable to log in when the password contains special characters.',
          labels: [{ name: 'stas:fix' }],
        },
        repository: {
          name: 'test-repo',
          full_name: 'owner/test-repo',
          private: false,
          owner: { login: 'owner' },
        },
        installation: { id: 555 },
      }),
    ),
    parsed: {
      action: 'labeled',
      issue: { number: 42 },
    },
  };
}

// ── Mock Triage Input/Output ─────────────────────────────────────────

export interface MockTriageInput {
  title: string;
  body: string;
}

export function createMockTriageInput(): MockTriageInput {
  return {
    title: 'Users are unable to log in when the password contains special characters.',
    body: 'When a user has special characters (like @, #, $, %) in their password, the login page shows a generic error. Expected: successful login.',
  };
}

export interface MockTriageResult {
  type: string;
  difficulty: string;
  relevantFiles: string[];
  summary: string;
}

export function createMockTriageResult(): MockTriageResult {
  return {
    type: 'bug',
    difficulty: 'medium',
    relevantFiles: ['src/auth/login.ts', 'src/auth/password.ts'],
    summary: 'Login fails when password contains special characters due to improper escaping.',
  };
}

// ── Mock Sandbox Payload ─────────────────────────────────────────────

export function createMockSandboxBootResult(): { sandboxId: string; repoDir: string; runtimeInfo: Record<string, string> } {
  return {
    sandboxId: 'mock-sandbox-abc123',
    repoDir: '/home/user/test-repo',
    runtimeInfo: {
      language: 'node',
      version: '22',
      testCommand: 'npm test',
      installCommand: 'npm install',
    },
  };
}

// ── Mock Job Data ────────────────────────────────────────────────────

export interface MockJobData {
  installationId: number;
  repoOwner: string;
  repoName: string;
  repoPrivate: boolean;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null;
}

export function createMockJobData(): MockJobData {
  return {
    installationId: 555,
    repoOwner: 'owner',
    repoName: 'test-repo',
    repoPrivate: false,
    issueNumber: 42,
    issueTitle: 'Fix broken user login',
    issueBody: 'Users are unable to log in when the password contains special characters.',
  };
}

// ── Mock BullMQ Queue ────────────────────────────────────────────────

export function createMockBullMQQueue() {
  return {
    add: vi.fn().mockImplementation(async (name: string, data: unknown, opts?: unknown) => ({
      id: 'mock-job-' + Date.now(),
      name,
      data,
      opts,
      timestamp: Date.now(),
    })),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockBullMQWorker() {
  return {
    process: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Mock Code Intelligence Input ─────────────────────────────────────

export interface MockCodeIntelInput {
  fileStructure: string;
  symbols: string[];
  imports: Record<string, string[]>;
}

export function createMockCodeIntelInput(): MockCodeIntelInput {
  return {
    fileStructure: [
      'src/index.ts',
      'src/server.ts',
      'src/config.ts',
      'src/agent/issueAgent.ts',
      'src/agent/types.ts',
      'src/agent/tools.ts',
      'src/webhooks/github.ts',
      'src/webhooks/base.ts',
      'src/webhooks/gitlab.ts',
      'src/webhooks/bitbucket.ts',
      'src/sandbox/executor.ts',
      'src/queue/issueQueue.ts',
      'src/queue/producers.ts',
      'src/queue/rabbitmq.ts',
      'src/github/auth.ts',
      'src/github/messages.ts',
      'src/github/actionDispatcher.ts',
    ].join('\n'),
    symbols: [
      'runIssueAgent', 'classifyIssue', 'dispatchToOpenCode',
      'buildCodeIntelligence', 'runVerification', 'attemptBasicFix',
      'createApp', 'startServer', 'enqueueIssue', 'createGithubWebhooks', 'SandboxExecutor',
    ],
    imports: {
      'src/server.ts': ['express', '@octokit/webhooks'],
      'src/agent/issueAgent.ts': ['openai', 'e2b'],
      'src/queue/issueQueue.ts': [],
    },
  };
}
