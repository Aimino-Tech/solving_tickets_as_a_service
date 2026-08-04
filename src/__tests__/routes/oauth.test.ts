/**
 * Unit tests for src/auth/oauth.ts — Google/Microsoft/GitHub OAuth via Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockConfig = vi.hoisted(() => ({
  supabase: { url: 'https://xyzcompany.supabase.co', anonKey: 'anon-key' },
  saml: { dashboardUrl: '' },
  port: 3000,
}));

const mockSignInWithOAuth = vi.hoisted(() => vi.fn());
const mockExchangeCodeForSession = vi.hoisted(() => vi.fn());
const mockGenerateTokens = vi.hoisted(() => vi.fn());
const mockQueryWithRetry = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());

// ── Captured route handlers ────────────────────────────────────────────────

const routeHandlers: Array<{ method: string; path: string; handler: Function }> = [];

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    get: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'get', path, handler: middleware[middleware.length - 1] });
    }),
    post: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'post', path, handler: middleware[middleware.length - 1] });
    }),
    use: vi.fn(),
  })),
}));

vi.mock('../../config.js', () => ({ config: mockConfig }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  })),
}));

vi.mock('../../auth/service.js', () => ({
  authService: { generateTokens: mockGenerateTokens },
  AuthError: class AuthError extends Error {},
}));

vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQueryWithRetry }));

vi.mock('../../audit/middleware.js', () => ({ auditLog: mockAuditLog }));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

// ── Test helpers ───────────────────────────────────────────────────────────

let moduleLoaded = false;

async function ensureModuleLoaded() {
  if (!moduleLoaded) {
    await import('../../auth/oauth.js');
    moduleLoaded = true;
  }
}

function findHandler(path: string): Function | undefined {
  return routeHandlers.find((h) => h.path === path)?.handler;
}

function makeRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(function (this: any, ...args: unknown[]) {
      this.redirectUrl = args[1] as string;
      return this;
    }),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    _getRedirectUrl: () => res.redirectUrl,
  };
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    params: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    requestId: 'test-request-id',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'test';
  process.env.SYNTARO_PUBLIC_URL = 'http://test.example.com';
  mockConfig.supabase.url = 'https://xyzcompany.supabase.co';
  mockConfig.supabase.anonKey = 'anon-key';
  mockConfig.saml.dashboardUrl = '';
  mockSignInWithOAuth.mockResolvedValue({
    data: {
      url: 'https://xyzcompany.supabase.co/auth/v1/authorize?provider=google&code_challenge=abc&code_challenge_method=s256',
      provider: 'google',
      flowId: 'flow-1',
    },
    error: null,
  });
  mockExchangeCodeForSession.mockResolvedValue({
    data: {
      user: { id: 'user-1', email: 'person@example.com', user_metadata: { name: 'Person' } },
    },
    error: null,
  });
  mockGenerateTokens.mockReturnValue({
    token: 'jwt-access-token',
    refreshToken: 'jwt-refresh-token',
    user: { id: 'user-1', email: 'person@example.com', emailVerified: true, name: 'Person' },
  });
  mockQueryWithRetry.mockResolvedValue({ rows: [] });
});

// ── Suite ──────────────────────────────────────────────────────────────────

describe('oauth routes', () => {
  it('GET /:provider/start redirects to the supabase-js authorize URL', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/start')!;
    const req = makeReq({ params: { provider: 'google' } });
    const res = makeRes();

    await handler(req, res);

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'http://test.example.com/api/v1/auth/oauth/google/callback',
        skipBrowserRedirect: true,
      },
    });
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/auth/v1/authorize?provider=google'));
  });

  it('GET /:provider/start supports azure and github providers', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/start')!;

    for (const provider of ['azure', 'github']) {
      const res = makeRes();
      await handler(makeReq({ params: { provider } }), res);
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider, options: expect.objectContaining({ skipBrowserRedirect: true }) }),
      );
      expect(res.redirect).toHaveBeenCalled();
    }
  });

  it('GET /:provider/start rejects unsupported providers with 400', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/start')!;
    const res = makeRes();

    await handler(makeReq({ params: { provider: 'facebook' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSignInWithOAuth).not.toHaveBeenCalled();
  });

  it('GET /:provider/start returns 501 when SUPABASE_URL is not configured', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/start')!;
    const res = makeRes();
    mockConfig.supabase.url = '';

    await handler(makeReq({ params: { provider: 'google' } }), res);

    expect(res.status).toHaveBeenCalledWith(501);
    expect(mockSignInWithOAuth).not.toHaveBeenCalled();
  });

  it('GET /:provider/start returns 500 when signInWithOAuth fails', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/start')!;
    const res = makeRes();
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: 'boom' } });

    await handler(makeReq({ params: { provider: 'google' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('GET /:provider/callback exchanges the code and redirects to the dashboard with tokens', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/callback')!;
    const res = makeRes();
    const req = makeReq({
      params: { provider: 'google' },
      query: { code: 'auth-code-123' },
    });

    await handler(req, res);

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('auth-code-123');
    expect(mockQueryWithRetry).toHaveBeenCalled();
    expect(mockGenerateTokens).toHaveBeenCalledWith('user-1', 'person@example.com', 'Person');
    expect(res._getRedirectUrl()).toContain(
      'http://localhost:5173/login?token=jwt-access-token&refreshToken=jwt-refresh-token',
    );
  });

  it('GET /:provider/callback redirects with error when code is missing', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/callback')!;
    const res = makeRes();

    await handler(makeReq({ params: { provider: 'google' }, query: {} }), res);

    expect(res._getRedirectUrl()).toContain('/login?error=invalid_oauth_callback');
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('GET /:provider/callback redirects with error when the code exchange fails', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/callback')!;
    const res = makeRes();
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: 'invalid code' } });

    await handler(makeReq({ params: { provider: 'google' }, query: { code: 'bad-code' } }), res);

    expect(res._getRedirectUrl()).toContain('/login?error=oauth_exchange_failed');
    expect(mockGenerateTokens).not.toHaveBeenCalled();
  });

  it('GET /:provider/callback redirects with error when the session has no user', async () => {
    await ensureModuleLoaded();
    const handler = findHandler('/:provider/callback')!;
    const res = makeRes();
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u1', email: null } }, error: null });

    await handler(makeReq({ params: { provider: 'google' }, query: { code: 'auth-code-123' } }), res);

    expect(res._getRedirectUrl()).toContain('/login?error=oauth_exchange_failed');
    expect(mockGenerateTokens).not.toHaveBeenCalled();
  });
});
