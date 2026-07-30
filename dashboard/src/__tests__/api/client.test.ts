import { describe, it, expect, vi, beforeEach } from 'vitest';

const API_BASE = '/api';

describe('API client', () => {
  let client: typeof import('@/api/client');

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    window.location.href = '';
    client = await import('@/api/client');
  });

  describe('token management', () => {
    it('setToken stores token in localStorage', () => {
      client.setToken('my-token');
      expect(localStorage.getItem('stas_token')).toBe('my-token');
    });

    it('getRefreshToken returns refresh token from localStorage', () => {
      localStorage.setItem('stas_refresh_token', 'my-refresh');
      expect(client.getRefreshToken()).toBe('my-refresh');
    });

    it('clearToken removes both tokens', () => {
      localStorage.setItem('stas_token', 't');
      localStorage.setItem('stas_refresh_token', 'rt');
      client.clearToken();
      expect(localStorage.getItem('stas_token')).toBeNull();
      expect(localStorage.getItem('stas_refresh_token')).toBeNull();
    });

    it('getToken returns null when no token', () => {
      expect(localStorage.getItem('stas_token')).toBeNull();
    });
  });

  describe('request', () => {
    it('includes Authorization header when token exists', async () => {
      localStorage.setItem('stas_token', 'test-jwt');
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ data: 'ok' }),
      });

      await client.request('/v1/test');

      const [url, opts] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/test`);
      expect(opts.headers['Authorization']).toBe('Bearer test-jwt');
      expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('skips Authorization when no token', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({}),
      });

      await client.request('/v1/public');

      const opts = (window.fetch as any).mock.calls[0][1];
      expect(opts.headers['Authorization']).toBeUndefined();
    });

    it('returns parsed JSON on success', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 1, name: 'test' }),
      });

      const result = await client.request<{ id: number; name: string }>('/v1/data');
      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('throws on 401 without refresh token and clears token for auth endpoints', async () => {
      localStorage.setItem('stas_token', 'expired');
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      await expect(client.request('/v1/auth/me')).rejects.toThrow('Unauthorized');
      expect(localStorage.getItem('stas_token')).toBeNull();
    });

    it('throws on 401 for login with proper message', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      });

      const err = await client.request('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'x', password: 'y' }),
      }).catch((e: Error) => e);

      expect(err.message).toBe('Invalid login credentials');
    });

    it('tries refresh token on 401 and retries successfully', async () => {
      localStorage.setItem('stas_token', 'expired');
      localStorage.setItem('stas_refresh_token', 'valid-refresh');

      let callCount = 0;
      (window.fetch as any).mockImplementation(async (_url: string, opts?: RequestInit) => {
        callCount++;
        if (_url.includes('/auth/refresh')) {
          return {
            ok: true, status: 200,
            json: () => Promise.resolve({ token: 'new-jwt', refreshToken: 'new-refresh' }),
          };
        }
        if (callCount === 1) {
          return {
            ok: false, status: 401,
            json: () => Promise.resolve({ error: 'Unauthorized' }),
          };
        }
        return {
          ok: true, status: 200,
          json: () => Promise.resolve({ data: 'retried' }),
        };
      });

      const result = await client.request<{ data: string }>('/v1/protected');
      expect(result).toEqual({ data: 'retried' });
      expect(callCount).toBe(3);
    });

    it('throws on 500 with error message from body', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      });

      await expect(client.request('/v1/error')).rejects.toThrow('Internal server error');
    });

    it('falls back to status text when JSON body has no error', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 503, statusText: 'Service Unavailable',
        json: () => Promise.reject(new Error('parse fail')),
      });

      await expect(client.request('/v1/error')).rejects.toThrow('Service Unavailable');
    });

    it('merges custom headers from options', async () => {
      localStorage.setItem('stas_token', 'tok');
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({}),
      });

      await client.request('/v1/data', { headers: { 'X-Custom': 'val' } as any });

      const opts = (window.fetch as any).mock.calls[0][1];
      expect(opts.headers['Authorization']).toBe('Bearer tok');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers['X-Custom']).toBe('val');
    });

    it('401 on non-auth endpoint redirects to /login when no refresh token', async () => {
      localStorage.setItem('stas_token', 'expired');
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      await expect(client.request('/v1/credits/balance')).rejects.toThrow('Unauthorized');
      expect(window.location.href).toBe('/login');
      expect(localStorage.getItem('stas_token')).toBeNull();
    });

    it('401 on non-auth endpoint redirects to /login when refresh fails', async () => {
      localStorage.setItem('stas_token', 'expired');
      localStorage.setItem('stas_refresh_token', 'expired-refresh');
      (window.fetch as any).mockImplementation(async (url: string) => {
        if (url.includes('/auth/refresh')) {
          return { ok: false, status: 401, json: () => Promise.resolve({}) };
        }
        return { ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) };
      });

      await expect(client.request('/v1/credits/balance')).rejects.toThrow('Unauthorized');
      expect(window.location.href).toBe('/login');
    });

    it('401 on /auth/login does NOT redirect', async () => {
      localStorage.setItem('stas_token', 'some-token');
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      });

      const err = await client.request('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'x', password: 'y' }),
      }).catch((e: Error) => e);

      expect(err.message).toBe('Invalid login credentials');
      expect(window.location.href).toBe('');
      expect(localStorage.getItem('stas_token')).toBe('some-token');
    });

    it('401 on /auth/register does NOT redirect', async () => {
      localStorage.setItem('stas_token', 'some-token');
      (window.fetch as any).mockResolvedValue({
        ok: false, status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      });

      const err = await client.request('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'x', password: 'y', name: 'Test' }),
      }).catch((e: Error) => e);

      expect(err.message).toBe('Invalid login credentials');
      expect(window.location.href).toBe('');
      expect(localStorage.getItem('stas_token')).toBe('some-token');
    });

    it('regression: 401 with successful refresh and retry returns data', async () => {
      localStorage.setItem('stas_token', 'expired');
      localStorage.setItem('stas_refresh_token', 'valid-refresh');
      let callCount = 0;
      (window.fetch as any).mockImplementation(async (url: string, _opts?: RequestInit) => {
        callCount++;
        if (url.includes('/auth/refresh')) {
          return {
            ok: true, status: 200,
            json: () => Promise.resolve({ token: 'new-jwt', refreshToken: 'new-refresh' }),
          };
        }
        if (callCount === 1) {
          return {
            ok: false, status: 401,
            json: () => Promise.resolve({ error: 'Unauthorized' }),
          };
        }
        return {
          ok: true, status: 200,
          json: () => Promise.resolve({ data: 'retried' }),
        };
      });

      const result = await client.request<{ data: string }>('/v1/credits/balance');
      expect(result).toEqual({ data: 'retried' });
      expect(callCount).toBe(3);
      expect(window.location.href).toBe('');
    });
  });

  describe('auth module', () => {
    it('login calls POST /api/v1/auth/login with credentials', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ token: 't', refreshToken: 'rt', user: { id: '1', email: 'a@b.com', name: null } }),
      });

      const result = await client.auth.login('a@b.com', 'pwd');

      const [url, opts] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/auth/login`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.com', password: 'pwd' });
      expect(result.token).toBe('t');
    });

    it('register calls POST /api/v1/auth/register with name', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ token: 't', refreshToken: 'rt', user: { id: '1', email: 'a@b.com', name: 'Test' } }),
      });

      await client.auth.register('a@b.com', 'pwd', 'Test');

      const [url, opts] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/auth/register`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.com', password: 'pwd', name: 'Test' });
    });

    it('me calls GET /api/v1/auth/me', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: '1', email: 'a@b.com', name: null, createdAt: '2024-01-01' }),
      });

      await client.auth.me();

      const [url] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/auth/me`);
    });

    it('logout calls POST /api/v1/auth/logout', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ message: 'logged out' }),
      });

      await client.auth.logout();

      const [url, opts] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/auth/logout`);
      expect(opts.method).toBe('POST');
    });

    it('loginUrl returns the OAuth URL string', () => {
      expect(client.auth.loginUrl()).toBe('/api/auth/github');
    });

    it('refresh calls POST /api/v1/auth/refresh', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ token: 't2', refreshToken: 'rt2', user: { id: '1', email: 'a@b.com', name: null } }),
      });

      await client.auth.refresh('some-refresh-token');

      const [url, opts] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/auth/refresh`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ refreshToken: 'some-refresh-token' });
    });
  });

  describe('credits module', () => {
    it('balance calls GET /api/v1/credits/balance', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ accountId: 1, balance: 1000, lifetimeCredits: 5000 }),
      });

      const result = await client.credits.balance();
      expect((window.fetch as any).mock.calls[0][0]).toBe(`${API_BASE}/v1/credits/balance`);
      expect(result.balance).toBe(1000);
    });

    it('transactions calls with limit and offset query params', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ transactions: [], pagination: { limit: 10, offset: 0, total: 0 } }),
      });

      await client.credits.transactions(10, 0);

      const [url] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/credits/transactions?limit=10&offset=0`);
    });

    it('topUp calls POST with priceId, successUrl, cancelUrl', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ url: 'https://checkout.stripe.com/test', sessionId: 'cs_123' }),
      });

      const result = await client.credits.topUp('price_123', 'https://app.com/success', 'https://app.com/cancel');

      const [url, opts] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/credits/top-up`);
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ priceId: 'price_123', successUrl: 'https://app.com/success', cancelUrl: 'https://app.com/cancel' });
      expect(result.url).toBe('https://checkout.stripe.com/test');
    });
  });

  describe('runs module', () => {
    it('list calls GET /api/v1/runs', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ data: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      });

      await client.runs.list();

      const [url] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/runs`);
    });

    it('list builds query string from params', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ data: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      });

      await client.runs.list({ page: 2, perPage: 10, status: 'completed', repo: 'owner/repo', from: '2024-01-01', to: '2024-06-01' });

      const [url] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/runs?page=2&perPage=10&status=completed&repo=owner%2Frepo&from=2024-01-01&to=2024-06-01`);
    });

    it('get calls GET /api/v1/runs/:id', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 'run-1', status: 'completed' }),
      });

      await client.runs.get('run-1');

      const [url] = (window.fetch as any).mock.calls[0];
      expect(url).toBe(`${API_BASE}/v1/runs/run-1`);
    });
  });

  describe('other modules', () => {
    it('github.getOAuthUrl calls POST', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ url: 'https://github.com/login/oauth/authorize' }),
      });

      const result = await client.github.getOAuthUrl();
      expect((window.fetch as any).mock.calls[0][0]).toBe(`${API_BASE}/v1/auth/github/url`);
      expect(result.url).toContain('github.com');
    });

    it('health.getStatus calls /api/health', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ status: 'ok', checks: {}, timestamp: new Date().toISOString() }),
      });

      await client.health.getStatus();
      expect((window.fetch as any).mock.calls[0][0]).toBe(`${API_BASE}/health`);
    });

    it('billing.plan returns billing plan', async () => {
      (window.fetch as any).mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 'pro', name: 'Pro', monthlyFixLimit: 100, concurrentFixes: 5 }),
      });

      const plan = await client.billing.plan();
      expect(plan.id).toBe('pro');
    });
  });
});
