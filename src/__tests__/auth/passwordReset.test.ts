import type { Router } from 'express';
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

const mockResetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'user-123', email: 'test@example.com' } },
  error: null,
});
const mockUpdateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });

vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      admin: {
        updateUserById: mockUpdateUserById,
      },
    },
  })),
  getSupabaseAnon: vi.fn(() => ({
    auth: {
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: mockGetUser,
    },
  })),
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
    headers: { origin: 'http://localhost:5173' },
    protocol: 'http',
    get: vi.fn((name: string) => (name === 'host' ? 'localhost:5173' : undefined)),
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

describe('password reset auth routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    });
    mockUpdateUserById.mockResolvedValue({ data: { user: {} }, error: null });
    const mod = await import('../../auth/routes.js');
    router = mod.default;
  });

  it('sends a password reset email with the recovery redirect URL', async () => {
    const { req, res } = mockReqRes('POST', '/forgot-password', { email: 'test@example.com' });
    await invokeRoute(router, 'POST', '/forgot-password', req, res);
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('test@example.com', {
      redirectTo: 'http://localhost:5173/auth/reset-password',
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('returns ok for unknown emails (anti-enumeration)', async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: 'No user found' },
    });
    const { req, res } = mockReqRes('POST', '/forgot-password', { email: 'nobody@example.com' });
    await invokeRoute(router, 'POST', '/forgot-password', req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('rejects invalid email format', async () => {
    const { req, res } = mockReqRes('POST', '/forgot-password', { email: 'not-an-email' });
    await invokeRoute(router, 'POST', '/forgot-password', req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 when the email provider errors', async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: 'Rate limit exceeded' },
    });
    const { req, res } = mockReqRes('POST', '/forgot-password', { email: 'test@example.com' });
    await invokeRoute(router, 'POST', '/forgot-password', req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('resets the password for a valid recovery token', async () => {
    const { req, res } = mockReqRes('POST', '/reset-password', {
      accessToken: 'valid-access-token',
      password: 'new-password-123',
    });
    await invokeRoute(router, 'POST', '/reset-password', req, res);
    expect(mockGetUser).toHaveBeenCalledWith('valid-access-token');
    expect(mockUpdateUserById).toHaveBeenCalledWith('user-123', { password: 'new-password-123' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('rejects a password shorter than 8 characters', async () => {
    const { req, res } = mockReqRes('POST', '/reset-password', {
      accessToken: 'valid-access-token',
      password: 'short',
    });
    await invokeRoute(router, 'POST', '/reset-password', req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired recovery token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } });
    const { req, res } = mockReqRes('POST', '/reset-password', {
      accessToken: 'expired-token',
      password: 'new-password-123',
    });
    await invokeRoute(router, 'POST', '/reset-password', req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('returns 500 when the password update fails', async () => {
    mockUpdateUserById.mockResolvedValue({ data: null, error: { message: 'update failed' } });
    const { req, res } = mockReqRes('POST', '/reset-password', {
      accessToken: 'valid-access-token',
      password: 'new-password-123',
    });
    await invokeRoute(router, 'POST', '/reset-password', req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
