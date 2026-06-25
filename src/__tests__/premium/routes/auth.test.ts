/**
 * Unit tests for premium auth routes — premium/src/routes/auth.ts
 *
 * Tests:
 *   - GET /github redirect to GitHub OAuth
 *   - GET /callback OAuth flow
 *   - GET /me authenticated user info
 *   - POST /logout
 *
 * Strategy:
 *   Mock the logger, jwt middleware, and fetch for GitHub API calls.
 *   Import the router and test via a lightweight request/response harness.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockLoggerChild = vi.hoisted(() => vi.fn(() => ({
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
})));

vi.mock('../../../../src/utils/logger.js', () => ({
  rootLogger: { child: mockLoggerChild },
}));

const mockSignJwt = vi.hoisted(() => vi.fn().mockReturnValue('mock-jwt-token'));
const mockJwtAuth = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
  req.user = { githubId: '123', username: 'testuser', avatarUrl: undefined };
  next();
}));

vi.mock('../../../../premium/src/middleware/auth.js', () => ({
  jwtAuth: mockJwtAuth,
  signJwt: mockSignJwt,
}));

// ── Suite ───────────────────────────────────────────────────────────────────

describe.skip('premium auth routes', () => {
  let router: import('express').Router;

  beforeAll(async () => {
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
    process.env.DASHBOARD_URL = 'http://localhost:5173';

    vi.clearAllMocks();
    const mod = await import('../../../../premium/src/routes/auth.js');
    router = mod.authRouter;
  });

  afterAll(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.DASHBOARD_URL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── GET /github ─────────────────────────────────────────────────────────

  describe('GET /github', () => {
    it('redirects to GitHub OAuth authorization URL', async () => {
      const { req, res } = mockReqRes('GET', '/github');
      res.redirect = vi.fn();
      res.cookie = vi.fn();
      res.status = vi.fn().mockReturnThis();
      res.json = vi.fn().mockReturnThis();

      // Find and invoke the route handler
      await invokeRoute(router, 'get', '/github', req, res);

      expect(res.redirect).toHaveBeenCalled();
      const redirectUrl = (res.redirect as any).mock.calls[0][0];
      expect(redirectUrl).toContain('https://github.com/login/oauth/authorize');
      expect(redirectUrl).toContain('client_id=test-client-id');
      expect(redirectUrl).toContain('redirect_uri=');
      expect(res.cookie).toHaveBeenCalledWith('oauth_state', expect.any(String), expect.any(Object));
    });

    it('returns 503 when GITHUB_CLIENT_ID is not configured', async () => {
      const origId = process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_ID;

      // Need to re-import to pick up the new env var
      vi.resetModules();
      vi.mock('../../../../src/utils/logger.js', () => ({
        rootLogger: { child: mockLoggerChild },
      }));
      vi.mock('../../../../premium/src/middleware/auth.js', () => ({
        jwtAuth: mockJwtAuth,
        signJwt: mockSignJwt,
      }));

      const mod = await import('../../../../premium/src/routes/auth.js');
      const newRouter = mod.authRouter;

      const { req, res } = mockReqRes('GET', '/github');
      res.redirect = vi.fn();
      res.cookie = vi.fn();
      res.status = vi.fn().mockReturnThis();
      res.json = vi.fn().mockReturnThis();

      await invokeRoute(newRouter, 'get', '/github', req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));

      process.env.GITHUB_CLIENT_ID = origId;
    });
  });

  // ── GET /callback ───────────────────────────────────────────────────────

  describe('GET /callback', () => {
    it('returns 400 when code is missing', async () => {
      const { req, res } = mockReqRes('GET', '/callback');
      req.query = {};
      req.cookies = {};
      res.status = vi.fn().mockReturnThis();
      res.json = vi.fn().mockReturnThis();

      await invokeRoute(router, 'get', '/callback', req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 401 when state does not match', async () => {
      const { req, res } = mockReqRes('GET', '/callback');
      req.query = { code: 'test-code', state: 'user-state' };
      req.cookies = { oauth_state: 'different-state' };
      res.status = vi.fn().mockReturnThis();
      res.json = vi.fn().mockReturnThis();

      await invokeRoute(router, 'get', '/callback', req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid state parameter' }));
    });
  });

  // ── GET /me ─────────────────────────────────────────────────────────────

  describe('GET /me', () => {
    it('returns the authenticated user', async () => {
      const { req, res } = mockReqRes('GET', '/me');
      req.user = { githubId: '123', username: 'testuser', avatarUrl: 'https://example.com/avatar.png' };
      res.json = vi.fn().mockReturnThis();

      await invokeRoute(router, 'get', '/me', req, res);

      expect(res.json).toHaveBeenCalledWith({ user: req.user });
    });
  });

  // ── POST /logout ────────────────────────────────────────────────────────

  describe('POST /logout', () => {
    it('returns success on logout', async () => {
      const { req, res } = mockReqRes('POST', '/logout');
      res.json = vi.fn().mockReturnThis();

      await invokeRoute(router, 'post', '/logout', req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});

// ── Test helpers ─────────────────────────────────────────────────────────────

function mockReqRes(method: string, path: string) {
  const req: any = {
    method,
    path,
    url: path,
    query: {},
    params: {},
    cookies: {},
    headers: {},
    user: undefined,
  };
  const res: any = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    end: vi.fn(),
  };
  return { req, res };
}

async function invokeRoute(
  router: import('express').Router,
  method: string,
  path: string,
  req: any,
  res: any,
): Promise<void> {
  // Find matching routes in the router stack
  const stack = (router as any).stack || [];
  for (const layer of stack) {
    if (layer.route) {
      const routeMethods = layer.route.methods;
      const routePath = layer.route.path;

      // Simple path matching (doesn't handle params)
      if (routeMethods[method] && matchesPath(routePath, path, req)) {
        // Execute the route handlers
        for (const handler of layer.route.stack) {
          await handler.handle(req, res, () => {});
        }
        return;
      }
    }
  }
}

function matchesPath(routePath: string, requestPath: string, req: any): boolean {
  // Simple exact or param matching
  const routeParts = routePath.split('/');
  const requestParts = requestPath.split('/');

  if (routeParts.length !== requestParts.length) return false;

  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) {
      // Extract param
      req.params[routeParts[i].slice(1)] = requestParts[i];
    } else if (routeParts[i] !== requestParts[i]) {
      return false;
    }
  }
  return true;
}
