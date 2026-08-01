import type { Router } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerChild = vi.hoisted(() => {
  const child = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return child;
});

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => mockLoggerChild) },
}));

vi.mock('../../config.js', () => ({
  config: {
    auth: { jwtSecret: 'test-secret', jwtExpiresIn: '1h', jwtRefreshExpiresIn: '7d' },
  },
}));

const mockListUsers = vi.fn().mockResolvedValue({
  data: { users: [{ id: 'user-123', email: 'test@example.com' }] },
});
const mockGetUserById = vi.fn().mockResolvedValue({
  data: {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      user_metadata: { name: 'Test' },
    },
  },
});

vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: mockListUsers,
        getUserById: mockGetUserById,
      },
    },
  })),
  getSupabaseAnon: vi.fn(),
}));

vi.mock('../../auth/rateLimit.js', () => ({
  loginLimiter: (req: unknown, res: unknown, next: () => void) => next(),
  registerLimiter: (req: unknown, res: unknown, next: () => void) => next(),
  refreshLimiter: (req: unknown, res: unknown, next: () => void) => next(),
}));

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../../audit/middleware.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../analytics/tracker.js', () => ({
  captureEvent: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let router: any;

function mockReqRes(method: string, path: string, body?: unknown) {
  const req = {
    method,
    path,
    url: path,
    query: {},
    params: {},
    cookies: {},
    headers: {},
    body,
  };
  const res = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    end: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

function matchesPath(routePath: string, path: string, req: { params: Record<string, string> }): boolean {
  const routeParts = routePath.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (routeParts.length !== pathParts.length) return false;
  for (let i = 0; i < routeParts.length; i += 1) {
    if (routeParts[i].startsWith(':')) {
      req.params[routeParts[i].slice(1)] = pathParts[i];
    } else if (routeParts[i] !== pathParts[i]) {
      return false;
    }
  }
  return true;
}

async function invokeRoute(routerToWalk: Router, method: string, path: string, req: unknown, res: unknown) {
  const stack = (
    routerToWalk as {
      stack: Array<{
        route?: {
          methods: Record<string, boolean>;
          path: string;
          stack: Array<{ handle: (r: unknown, s: unknown, next: () => void) => Promise<void> }>;
        };
      }>;
    }
  ).stack;
  for (const layer of stack) {
    if (!layer.route) continue;
    const routeMethods = Object.keys(layer.route.methods);
    if (!routeMethods.includes(method.toLowerCase())) continue;
    const reqWithParams = req as { params: Record<string, string> };
    if (!matchesPath(layer.route.path, path, reqWithParams)) continue;
    for (const handler of layer.route.stack) {
      await handler.handle(req, res, () => {});
    }
    return;
  }
}

describe('magic-link auth routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'user-123', email: 'test@example.com' }] },
    });
    mockGetUserById.mockResolvedValue({
      data: {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          user_metadata: { name: 'Test' },
        },
      },
    });
    const mod = await import('../../auth/routes.js');
    router = mod.default;
  });

  it('issues a magic link for a known email', async () => {
    const { req, res } = mockReqRes('POST', '/magic-link', { email: 'test@example.com' });
    await invokeRoute(router, 'POST', '/magic-link', req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, message: expect.stringContaining('sign-in link') }),
    );
  });

  it('returns ok for unknown emails (anti-enumeration)', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [] } });
    const { req, res } = mockReqRes('POST', '/magic-link', { email: 'nobody@example.com' });
    await invokeRoute(router, 'POST', '/magic-link', req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, message: expect.stringContaining('sign-in link') }),
    );
  });

  it('rejects invalid email format', async () => {
    const { req, res } = mockReqRes('POST', '/magic-link', { email: 'not-an-email' });
    await invokeRoute(router, 'POST', '/magic-link', req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('verifies a valid magic link token and returns tokens', async () => {
    const token = jwt.sign({ sub: 'user-123', email: 'test@example.com', purpose: 'magic_link' }, 'test-secret', {
      expiresIn: '15m',
    });
    const { req, res } = mockReqRes('POST', '/magic-link/verify', { token });
    await invokeRoute(router, 'POST', '/magic-link/verify', req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        refreshToken: expect.any(String),
        user: expect.objectContaining({ id: 'user-123', email: 'test@example.com' }),
      }),
    );
  });

  it('rejects a token with the wrong purpose', async () => {
    const token = jwt.sign({ sub: 'user-123', email: 'test@example.com', purpose: 'email_verify' }, 'test-secret', {
      expiresIn: '15m',
    });
    const { req, res } = mockReqRes('POST', '/magic-link/verify', { token });
    await invokeRoute(router, 'POST', '/magic-link/verify', req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid magic link' });
  });

  it('rejects a garbage token', async () => {
    const { req, res } = mockReqRes('POST', '/magic-link/verify', { token: 'not-a-token' });
    await invokeRoute(router, 'POST', '/magic-link/verify', req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired magic link' });
  });

  it('rejects verification when the user no longer exists', async () => {
    mockGetUserById.mockResolvedValue({ data: { user: null } });
    const token = jwt.sign({ sub: 'user-123', email: 'test@example.com', purpose: 'magic_link' }, 'test-secret', {
      expiresIn: '15m',
    });
    const { req, res } = mockReqRes('POST', '/magic-link/verify', { token });
    await invokeRoute(router, 'POST', '/magic-link/verify', req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired magic link' });
  });
});
