/**
 * Unit tests for src/routes/githubOAuth.ts — GitHub OAuth routes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockConfig = vi.hoisted(() => ({
  github: {
    oauthClientId: 'test-client-id',
    oauthClientSecret: 'test-client-secret',
  },
  port: 3000,
}));

const mockFindByUserId = vi.hoisted(() => vi.fn());
const mockFindByGithubUserId = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockVerifyToken = vi.hoisted(() => vi.fn());
const mockGenerateTokens = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());
const mockCreateUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: { id: 'new-user-uuid', email: 'newuser@github.user' } },
    error: null,
  }),
);
const mockFetch = vi.hoisted(() => vi.fn());

// ── Captured route handlers ────────────────────────────────────────────────

const routeHandlers: Array<{ method: string; path: string; handler: Function }> = [];

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    use: vi.fn(),
    get: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'get', path, handler: middleware[middleware.length - 1] });
    }),
    post: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'post', path, handler: middleware[middleware.length - 1] });
    }),
    delete: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'delete', path, handler: middleware[middleware.length - 1] });
    }),
  })),
}));

vi.mock('../../config.js', () => ({ config: mockConfig }));

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'test-uuid-123', email: 'test@test.com' };
    next();
  }),
}));

vi.mock('../../auth/service.js', () => ({
  authService: {
    verifyToken: mockVerifyToken,
    generateTokens: mockGenerateTokens,
  },
}));

vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: { admin: { createUser: mockCreateUser } },
  })),
}));

vi.mock('../../db/repositories/GitHubOAuthRepository.js', () => ({
  gitHubOAuthRepository: {
    findByGithubUserId: mockFindByGithubUserId,
    findByUserId: mockFindByUserId,
    upsert: mockUpsert,
    delete: mockDelete,
  },
}));

vi.mock('../../utils/encryption.js', () => ({ encrypt: mockEncrypt }));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

// ── Test helpers ───────────────────────────────────────────────────────────

function mockReqRes(method: string, path: string) {
  let statusCode = 200;
  const req: any = {
    method, path, url: path,
    query: {}, params: {}, body: {}, headers: {},
    user: undefined,
  };
  const res: any = {
    status: vi.fn((code: number) => { statusCode = code; return res; }),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
    _getStatusCode: () => statusCode,
  };
  return { req, res };
}

function findHandler(method: string, path: string): Function | undefined {
  return routeHandlers.find((h) => h.method === method && h.path === path)?.handler;
}

let moduleLoaded = false;

async function ensureModuleLoaded() {
  if (!moduleLoaded) {
    await import('../../routes/githubOAuth.js');
    moduleLoaded = true;
  }
}

const mockToken = {
  id: 1,
  userId: 'test-uuid-123',
  accessTokenEncrypted: 'encrypted-token',
  refreshTokenEncrypted: 'encrypted-refresh',
  githubLogin: 'testuser',
  githubUserId: 12345,
  avatarUrl: null,
  tokenExpiresAt: new Date('2027-01-01'),
  refreshTokenExpiresAt: new Date('2027-06-01'),
  scope: 'repo,user',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

// ── Suite ──────────────────────────────────────────────────────────────────

describe('githubOAuth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SYNTARO_PUBLIC_URL = 'http://test.example.com';
    mockConfig.github.oauthClientId = 'test-client-id';
    mockConfig.github.oauthClientSecret = 'test-client-secret';
    mockConfig.port = 3000;
  });

  // -----------------------------------------------------------------------
  // POST /url
  // -----------------------------------------------------------------------

  describe('POST /url', () => {
    it('returns a GitHub OAuth URL', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/url')!;
      const { req, res } = mockReqRes('POST', '/url');

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('https://github.com/login/oauth/authorize') }),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('client_id=test-client-id') }),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('redirect_uri=http%3A%2F%2Ftest.example.com%2Fapi%2Fv1%2Fauth%2Fgithub%2Fcallback') }),
      );
    });

    it('returns 501 when oauthClientId is not configured', async () => {
      mockConfig.github.oauthClientId = '';

      await ensureModuleLoaded();
      const handler = findHandler('post', '/url')!;
      const { req, res } = mockReqRes('POST', '/url');

      await handler(req, res);

      expect(res._getStatusCode()).toBe(501);
      expect(res.json).toHaveBeenCalledWith({
        error: 'GitHub OAuth not configured — set GITHUB_OAUTH_CLIENT_ID',
      });
    });
  });

  // -----------------------------------------------------------------------
  // GET /status
  // -----------------------------------------------------------------------

  describe('GET /status', () => {
    it('returns { connected: false } when no token found', async () => {
      mockFindByUserId.mockResolvedValue(undefined);

      await ensureModuleLoaded();
      const handler = findHandler('get', '/status')!;
      const { req, res } = mockReqRes('GET', '/status');
      req.user = { id: 'test-uuid-123', email: 'test@test.com' };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ connected: false });
    });

    it('returns { connected: true, githubLogin } when token exists', async () => {
      mockFindByUserId.mockResolvedValue(mockToken);

      await ensureModuleLoaded();
      const handler = findHandler('get', '/status')!;
      const { req, res } = mockReqRes('GET', '/status');
      req.user = { id: 'test-uuid-123', email: 'test@test.com' };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        connected: true,
        githubLogin: 'testuser',
        githubUserId: 12345,
      });
    });
  });

  // -----------------------------------------------------------------------
  // GET /profile
  // -----------------------------------------------------------------------

  describe('GET /profile', () => {
    it('returns profile when token exists', async () => {
      mockFindByUserId.mockResolvedValue(mockToken);

      await ensureModuleLoaded();
      const handler = findHandler('get', '/profile')!;
      const { req, res } = mockReqRes('GET', '/profile');
      req.user = { id: 'test-uuid-123', email: 'test@test.com' };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        id: 1,
        githubLogin: 'testuser',
        githubUserId: 12345,
        avatarUrl: null,
        scope: 'repo,user',
        tokenExpiresAt: mockToken.tokenExpiresAt,
        createdAt: mockToken.createdAt,
      });
    });

    it('returns 404 when no token found', async () => {
      mockFindByUserId.mockResolvedValue(undefined);

      await ensureModuleLoaded();
      const handler = findHandler('get', '/profile')!;
      const { req, res } = mockReqRes('GET', '/profile');
      req.user = { id: 'test-uuid-123', email: 'test@test.com' };

      await handler(req, res);

      expect(res._getStatusCode()).toBe(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'No GitHub OAuth token found' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /disconnect
  // -----------------------------------------------------------------------

  describe('DELETE /disconnect', () => {
    it('returns { success: true }', async () => {
      mockDelete.mockResolvedValue(true);

      await ensureModuleLoaded();
      const handler = findHandler('delete', '/disconnect')!;
      const { req, res } = mockReqRes('DELETE', '/disconnect');
      req.user = { id: 'test-uuid-123', email: 'test@test.com' };

      await handler(req, res);

      expect(mockDelete).toHaveBeenCalledWith('test-uuid-123');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
