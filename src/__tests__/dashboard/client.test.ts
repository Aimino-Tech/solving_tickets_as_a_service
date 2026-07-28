/**
 * Unit tests for dashboard API client — dashboard/src/api/client.ts
 *
 * Tests the HTTP client layer that wraps fetch() with auth token management,
 * JSON parsing, error handling, and 401 auto-redirect.
 *
 * Strategy:
 *   Mock fetch() and localStorage to isolate the client from browser APIs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockLocalStorage } = vi.hoisted(() => {
  let store: Record<string, string> = {};
  return {
    mockLocalStorage: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { store = {}; }),
      get length() { return Object.keys(store).length; },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    },
  };
});

const mockFetch = vi.hoisted(() => vi.fn());

vi.stubGlobal('localStorage', mockLocalStorage);
vi.stubGlobal('fetch', mockFetch);

// Mock window.location for redirect testing
const mockLocation = vi.hoisted(() => ({ href: '' }));
Object.defineProperty(globalThis, 'window', {
  value: { location: mockLocation, history: { replaceState: vi.fn() } },
  writable: true,
});

// ── Suite ───────────────────────────────────────────────────────────────────

describe('dashboard API client', () => {
  // Module-level imports (after mocks are set up)
  let client: typeof import('../../../dashboard/src/api/client.js');

  beforeAll(async () => {
    // Clear any pre-existing token
    mockLocalStorage.clear();
    vi.clearAllMocks();
    client = await import('../../../dashboard/src/api/client.js');
  });

  beforeEach(() => {
    mockLocalStorage.clear();
    mockFetch.mockReset();
    mockLocation.href = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Token management ────────────────────────────────────────────────────

  describe('token management', () => {
    it('setToken stores the token in localStorage', () => {
      client.setToken('test-token-123');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('stas_token', 'test-token-123');
    });

    it('clearToken removes the token from localStorage', () => {
      client.setToken('test-token');
      client.clearToken();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('stas_token');
    });
  });

  // ── Auth API ────────────────────────────────────────────────────────────

  describe('auth', () => {
    it('loginUrl returns the GitHub OAuth URL', () => {
      const url = client.auth.loginUrl();
      expect(url).toBe('/api/auth/github');
    });

    it('me() calls GET /auth/me with Bearer token', async () => {
      client.setToken('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { githubId: '123', username: 'testuser' } }),
      });

      const result = await client.auth.me();
      expect(result.user.username).toBe('testuser');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('logout() sends POST /auth/logout', async () => {
      client.setToken('test-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const result = await client.auth.logout();
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ── Runs API ────────────────────────────────────────────────────────────

  describe('runs', () => {
    it('list() fetches paginated runs', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: '1', issueTitle: 'Fix bug' }],
          total: 1,
          page: 1,
          perPage: 20,
          totalPages: 1,
        }),
      });

      const result = await client.runs.list({ page: 1, perPage: 20 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].issueTitle).toBe('Fix bug');
    });

    it('list() builds query string from params', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      });

      await client.runs.list({ status: 'failed', repo: 'my-org/app' });
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('status=failed');
      expect(calledUrl).toContain('repo=my-org%2Fapp');
    });

    it('get() fetches a single run by id', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'run-42', issueTitle: 'Detail view' }),
      });

      const result = await client.runs.get('run-42');
      expect(result.id).toBe('run-42');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/runs/run-42', expect.any(Object));
    });
  });

  // ── Repos API ───────────────────────────────────────────────────────────

  describe('repos', () => {
    it('list() fetches all repos', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: '1', owner: 'my-org', repo: 'app' }],
      });

      const result = await client.repos.list();
      expect(result).toHaveLength(1);
    });

    it('connect() POSTs a new repo connection', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'new-id', owner: 'my-org', repo: 'new-app', active: true }),
      });

      const result = await client.repos.connect({ owner: 'my-org', repo: 'new-app' });
      expect(result.id).toBe('new-id');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/repos',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"owner":"my-org"'),
        }),
      );
    });

    it('disconnect() sends DELETE', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const result = await client.repos.disconnect('repo-1');
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/repos/repo-1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  // ── Stats API ───────────────────────────────────────────────────────────

  describe('stats', () => {
    it('get() fetches dashboard statistics', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ totalRuns: 100, passRate: 0.85 }),
      });

      const result = await client.stats.get();
      expect(result.totalRuns).toBe(100);
      expect(result.passRate).toBe(0.85);
    });
  });

  // ── Audit API ───────────────────────────────────────────────────────────

  describe('audit', () => {
    it('list() fetches paginated audit entries', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'a1', action: 'run_started' }],
          total: 1,
          page: 1,
          perPage: 30,
          totalPages: 1,
        }),
      });

      const result = await client.audit.list({ page: 1, perPage: 30 });
      expect(result.data).toHaveLength(1);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on non-OK response with error body', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad request' }),
      });

      await expect(client.auth.me()).rejects.toThrow('Bad request');
    });

    it('throws on non-OK response without error body', async () => {
      client.setToken('tok');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => { throw new Error('no json'); },
      });

      await expect(client.auth.me()).rejects.toThrow(/Internal Server Error/);
    });

    it('throws on network error', async () => {
      client.setToken('tok');
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      // The underlying request will throw; me() is just a wrapper
      await expect(client.auth.me()).rejects.toThrow();
    });
  });
});
