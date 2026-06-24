import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BitbucketPlatformClient } from '../../../platforms/bitbucket/index.js';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

const token = 'testuser:test-app-password';

describe('Bitbucket PlatformClient', () => {
  let client: BitbucketPlatformClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new BitbucketPlatformClient(token);
  });

  describe('getIssue', () => {
    it('fetches issue by id and returns normalized data', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 42,
          title: 'Fix login bug',
          content: { raw: 'Users cannot log in' },
          state: 'new',
        }),
      );

      const result = await client.getIssue('owner/test-repo', 42);

      expect(result).toEqual({
        id: 42,
        number: 42,
        title: 'Fix login bug',
        body: 'Users cannot log in',
        labels: [],
        repoOwner: 'owner',
        repoName: 'test-repo',
        state: 'new',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/owner/test-repo/issues/42',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Not found' }, 404));

      await expect(client.getIssue('owner/test-repo', 999)).rejects.toThrow(
        'Bitbucket API',
      );
    });

    it('handles null content', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 43,
          title: 'No content issue',
          content: null,
          state: 'new',
        }),
      );

      const result = await client.getIssue('owner/test-repo', 43);
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

      await client.createComment('owner/test-repo', 42, 'Working on it');

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
        client.createComment('owner/test-repo', 42, 'test'),
      ).rejects.toThrow('Bitbucket API');
    });
  });

  describe('createPullRequest', () => {
    it('creates a pull request and returns url and number', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          id: 100,
          title: 'Fix: login bug',
          links: { html: { href: 'https://bitbucket.org/owner/test-repo/pull-requests/100' } },
          state: 'OPEN',
        }),
      );

      const result = await client.createPullRequest({
        repoOwner: 'owner',
        repoName: 'test-repo',
        title: 'Fix: login bug',
        head: 'stas/fix-42',
        base: 'main',
        body: 'This PR fixes the login bug',
      });

      expect(result).toEqual({
        url: 'https://bitbucket.org/owner/test-repo/pull-requests/100',
        number: 100,
        title: 'Fix: login bug',
        state: 'open',
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

      await expect(client.createPullRequest({
        repoOwner: 'owner',
        repoName: 'test-repo',
        title: 'Fix: login bug',
        head: 'stas/fix-42',
        base: 'main',
        body: 'Fix',
      })).rejects.toThrow('Bitbucket API');
    });
  });

  describe('setStatus', () => {
    it('logs warning since setStatus is not directly supported', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await client.setStatus({
        repoOwner: 'owner',
        repoName: 'test-repo',
        sha: 'abc123def',
        state: 'success',
        description: 'Tests passed',
        targetUrl: 'https://ci.example.com/build/1',
      });
      expect(mockFetch).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
