import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../config.js', () => ({
  config: {
    bitbucket: {
      username: 'testuser',
      appPassword: 'test-app-password',
      webhookSecret: 'test-secret',
      baseUrl: 'https://api.bitbucket.org',
    },
  },
}));

vi.mock('../../../utils/logger.js', () => {
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

import { bitbucketPlatformClient } from '../../../platforms/bitbucket/index.js';
import { bitbucketCache } from '../../../platforms/bitbucket/cache.js';
import type { CreatePullRequestParams, PlatformWebhookEvent } from '../../../webhooks/base.js';

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('Bitbucket PlatformClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bitbucketCache.clear();
  });

  describe('getIssue', () => {
    it('fetches issue by id and returns normalized data', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 42,
          title: 'Fix login bug',
          content: { raw: 'Users cannot log in' },
          state: 'new',
          kind: 'bug',
          priority: 'major',
        }),
      );

      const result = await bitbucketPlatformClient.getIssue('owner', 'test-repo', 42);

      expect(result).toEqual({
        id: 42,
        title: 'Fix login bug',
        body: 'Users cannot log in',
        state: 'new',
        kind: 'bug',
        priority: 'major',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/owner/test-repo/issues/42',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('uses cache on second call', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 42,
          title: 'Fix login bug',
          content: { raw: 'Users cannot log in' },
          state: 'new',
          kind: 'bug',
          priority: 'major',
        }),
      );

      await bitbucketPlatformClient.getIssue('owner', 'test-repo', 42);
      const cachedEntry = bitbucketCache.get<{ id: number }>(`issue:owner/test-repo#42`);
      expect(cachedEntry).toBeDefined();
      expect(cachedEntry?.id).toBe(42);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Not found' }, 404));

      await expect(bitbucketPlatformClient.getIssue('owner', 'test-repo', 999)).rejects.toThrow(
        'Bitbucket GET',
      );
    });

    it('handles null content', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 43,
          title: 'No content issue',
          content: null,
          state: 'new',
          kind: 'task',
          priority: 'trivial',
        }),
      );

      const result = await bitbucketPlatformClient.getIssue('owner', 'test-repo', 43);
      expect(result.body).toBeNull();
    });
  });

  describe('createComment', () => {
    it('posts comment to issue endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 1,
          content: { raw: 'Working on it' },
        }),
      );

      await bitbucketPlatformClient.createComment('owner', 'test-repo', 42, 'Working on it');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/owner/test-repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: { raw: 'Working on it' } }),
        }),
      );
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Bad request' }, 400));

      await expect(
        bitbucketPlatformClient.createComment('owner', 'test-repo', 42, 'test'),
      ).rejects.toThrow('Bitbucket POST');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('createPrComment', () => {
    it('posts comment to pull request endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 1,
          content: { raw: 'PR review comment' },
        }),
      );

      await bitbucketPlatformClient.createPrComment('owner', 'test-repo', 10, 'PR review comment');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/owner/test-repo/pullrequests/10/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: { raw: 'PR review comment' } }),
        }),
      );
    });
  });

  describe('createPullRequest', () => {
    const validParams: CreatePullRequestParams = {
      repoOwner: 'owner',
      repoName: 'test-repo',
      title: 'Fix: login bug',
      head: 'stas/fix-42',
      base: 'main',
      body: 'This PR fixes the login bug',
    };

    it('creates a pull request and returns url and number', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 100,
          title: 'Fix: login bug',
          links: { html: { href: 'https://bitbucket.org/owner/test-repo/pull-requests/100' } },
          state: 'OPEN',
          source: { branch: { name: 'stas/fix-42' } },
          destination: { branch: { name: 'main' } },
        }),
      );

      const result = await bitbucketPlatformClient.createPullRequest(validParams);

      expect(result).toEqual({
        url: 'https://bitbucket.org/owner/test-repo/pull-requests/100',
        number: 100,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/owner/test-repo/pullrequests',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Fix: login bug',
            description: 'This PR fixes the login bug',
            source: { branch: { name: 'stas/fix-42' } },
            destination: { branch: { name: 'main' } },
          }),
        }),
      );
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Conflict' }, 409));

      await expect(bitbucketPlatformClient.createPullRequest(validParams)).rejects.toThrow(
        'Bitbucket POST',
      );
    });
  });

  describe('setStatus', () => {
    it('sets build status on a commit', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          key: 'stas-build-1',
          state: 'SUCCESSFUL',
          name: 'STAS Fix Build',
          url: 'https://stas.dev/runs/1',
          description: 'Fix completed successfully',
        }),
      );

      const result = await bitbucketPlatformClient.setStatus(
        'owner',
        'test-repo',
        'abc123def',
        'SUCCESSFUL',
        'stas-build-1',
        'STAS Fix Build',
        'https://stas.dev/runs/1',
        'Fix completed successfully',
      );

      expect(result).toEqual({
        key: 'stas-build-1',
        state: 'SUCCESSFUL',
        name: 'STAS Fix Build',
        url: 'https://stas.dev/runs/1',
        description: 'Fix completed successfully',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/owner/test-repo/commit/abc123def/statuses/build',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            key: 'stas-build-1',
            state: 'SUCCESSFUL',
            name: 'STAS Fix Build',
            url: 'https://stas.dev/runs/1',
            description: 'Fix completed successfully',
          }),
        }),
      );
    });

    it('accepts all valid states', async () => {
      const states = ['INPROGRESS', 'SUCCESSFUL', 'FAILED', 'STOPPED'] as const;
      for (const state of states) {
        mockFetch.mockResolvedValueOnce(
          mockResponse({ key: 'test', state, name: 'test' }),
        );
        const result = await bitbucketPlatformClient.setStatus(
          'owner', 'test-repo', 'abc', state as any, 'test', 'test',
        );
        expect(result.state).toBe(state);
      }
    });
  });

  describe('toIssueJobData', () => {
    it('converts a PlatformWebhookEvent to IssueJobData', () => {
      const event: PlatformWebhookEvent = {
        platform: 'bitbucket',
        eventType: 'issue.opened',
        issue: {
          id: 42,
          number: 42,
          title: 'Fix bug',
          body: 'Bug description',
          labels: ['bug'],
          repoOwner: 'owner',
          repoName: 'test-repo',
          repoPrivate: false,
        },
        raw: {},
      };

      const jobData = bitbucketPlatformClient.toIssueJobData(event);
      expect(jobData.repoOwner).toBe('owner');
      expect(jobData.repoName).toBe('test-repo');
      expect(jobData.issueNumber).toBe(42);
      expect(jobData.issueTitle).toBe('Fix bug');
      expect(jobData.issueBody).toBe('Bug description');
      expect(jobData.source).toBe('bitbucket');
    });
  });

  describe('rate limit caching', () => {
    it('caches GET responses and returns cached data within TTL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 42,
          title: 'First fetch',
          content: { raw: 'data' },
          state: 'new',
          kind: 'bug',
          priority: 'major',
        }),
      );

      const first = await bitbucketPlatformClient.getIssue('owner', 'test-repo', 42);
      expect(first.title).toBe('First fetch');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const second = await bitbucketPlatformClient.getIssue('owner', 'test-repo', 42);
      expect(second.title).toBe('First fetch');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('refetches after cache expires', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            id: 42,
            title: 'Original',
            content: { raw: 'data' },
            state: 'new',
            kind: 'bug',
            priority: 'major',
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            id: 42,
            title: 'Updated',
            content: { raw: 'data' },
            state: 'new',
            kind: 'bug',
            priority: 'major',
          }),
        );

      const first = await bitbucketPlatformClient.getIssue('owner', 'test-repo', 42);
      expect(first.title).toBe('Original');

      bitbucketCache.clear();

      const second = await bitbucketPlatformClient.getIssue('owner', 'test-repo', 42);
      expect(second.title).toBe('Updated');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
