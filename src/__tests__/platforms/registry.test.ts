import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  config: {
    bitbucket: {
      username: 'testuser',
      appPassword: 'test-app-password',
      webhookSecret: 'test-secret',
      baseUrl: 'https://api.bitbucket.org',
    },
  },
}));

vi.mock('../../utils/logger.js', () => {
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
  return { rootLogger: logger };
});

import { registerPlatformClient, getPlatformClient, getAllPlatformClients } from '../../platforms/registry.js';
import type { PlatformClient, PlatformWebhookEvent } from '../../webhooks/base.js';

const mockToIssueJobData = (_event: PlatformWebhookEvent) => ({
  installationId: 0,
  repoOwner: 'test' as const,
  repoName: 'test' as const,
  repoPrivate: false,
  issueNumber: 1,
  issueTitle: 'test' as const,
  issueBody: 'test' as const,
  source: 'bitbucket' as const,
});

const mockGithubToIssueJobData = (_event: PlatformWebhookEvent) => ({
  installationId: 0,
  repoOwner: 'test' as const,
  repoName: 'test' as const,
  repoPrivate: false,
  issueNumber: 1,
  issueTitle: 'test' as const,
  issueBody: 'test' as const,
  source: 'github' as const,
});

const mockClient: PlatformClient = {
  platform: 'bitbucket',
  createComment: vi.fn().mockResolvedValue(undefined),
  createPullRequest: vi.fn().mockResolvedValue({ url: 'https://example.com/pr/1', number: 1 }),
  toIssueJobData: mockToIssueJobData as PlatformClient['toIssueJobData'],
};

const mockGithubClient: PlatformClient = {
  platform: 'github',
  createComment: vi.fn().mockResolvedValue(undefined),
  createPullRequest: vi.fn().mockResolvedValue({ url: 'https://github.com/pr/1', number: 1 }),
  toIssueJobData: mockGithubToIssueJobData as PlatformClient['toIssueJobData'],
};

describe('Platform Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers and retrieves a platform client', () => {
    registerPlatformClient('github', mockGithubClient);
    const client = getPlatformClient('github');
    expect(client).toBeDefined();
    expect(client?.platform).toBe('github');
  });

  it('returns undefined for unregistered platform', () => {
    const client = getPlatformClient('gitlab' as any);
    expect(client).toBeUndefined();
  });

  it('lists all registered platform clients', () => {
    registerPlatformClient('bitbucket', mockClient);
    const all = getAllPlatformClients();
    expect(all.size).toBeGreaterThanOrEqual(1);
  });

  it('overwrites existing client when re-registering', () => {
    const newToIssueJobData = (_event: PlatformWebhookEvent) => ({
      installationId: 0,
      repoOwner: 'test' as const,
      repoName: 'test' as const,
      repoPrivate: false,
      issueNumber: 1,
      issueTitle: 'test' as const,
      issueBody: 'test' as const,
      source: 'bitbucket' as const,
    });
    const newClient: PlatformClient = {
      platform: 'bitbucket',
      createComment: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({ url: 'https://example.com/v2/pr/1', number: 2 }),
      toIssueJobData: newToIssueJobData as PlatformClient['toIssueJobData'],
    };

    registerPlatformClient('bitbucket', newClient);
    const client = getPlatformClient('bitbucket');
    expect(client?.createPullRequest).toBeDefined();
  });
});
