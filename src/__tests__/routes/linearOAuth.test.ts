import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  port: 3000,
}));

const mockFindByUserId = vi.hoisted(() => vi.fn());
const mockFindByLinearUserId = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockVerifyToken = vi.hoisted(() => vi.fn());
const mockGenerateTokens = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());
const mockCreateUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: { id: 'new-user-uuid', email: 'newuser@linear.user' } },
    error: null,
  }),
);
const mockFetch = vi.hoisted(() => vi.fn());

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
vi.mock('../../auth/service.js', () => ({
  authService: { verifyToken: mockVerifyToken, generateTokens: mockGenerateTokens },
}));
vi.mock('../../auth/middleware.js', () => ({
  requireAuth: (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
    req.user = { id: 'u1' };
    next();
  },
}));
vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: { admin: { createUser: mockCreateUser } },
  })),
}));
vi.mock('../../db/repositories/LinearOAuthRepository.js', () => ({
  linearOAuthRepository: {
    findByUserId: mockFindByUserId,
    findByLinearUserId: mockFindByLinearUserId,
    upsert: mockUpsert,
    delete: mockDelete,
  },
}));
vi.mock('../../utils/encryption.js', () => ({ encrypt: mockEncrypt }));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));
vi.mock('../../audit/middleware.js', () => ({ auditLog: vi.fn() }));

import type { Request, Response } from 'express';

let moduleLoaded = false;

async function ensureModuleLoaded() {
  if (!moduleLoaded) {
    await import('../../routes/linearOAuth.js');
    moduleLoaded = true;
  }
}

async function callRoute(
  method: string,
  path: string,
  req: { headers?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown>; user?: unknown } = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const entry = routeHandlers.find((r) => r.method === method && r.path === path);
  if (!entry) throw new Error(`No ${method.toUpperCase()} route for ${path}`);
  let statusCode = 200;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value as Record<string, unknown>;
      return this;
    },
    redirect(code: number, url: string) {
      statusCode = code;
      body = { url };
      return this;
    },
    end() {
      return this;
    },
    setHeader: () => this,
  } as unknown as Response;
  const fullReq = {
    headers: {},
    query: {},
    body: {},
    user: { id: 'u1', email: 'a@b.c' },
    ...req,
  } as Request;
  await entry.handler(fullReq, res, () => {});
  return { statusCode, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LINEAR_OAUTH_CLIENT_ID;
  delete process.env.LINEAR_OAUTH_CLIENT_SECRET;
});

describe('Linear OAuth routes (AIM-4496)', () => {
  it('registers expected routes', async () => {
    await ensureModuleLoaded();
    expect(routeHandlers.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'post /url',
        'get /callback',
        'post /token',
        'post /callback',
        'get /status',
        'get /profile',
        'delete /disconnect',
      ]),
    );
  });

  it('POST /url returns 501 when Linear OAuth not configured', async () => {
    await ensureModuleLoaded();
    const result = await callRoute('post', '/url');
    expect(result.statusCode).toBe(501);
  });

  it('POST /url returns an authorization URL when configured', async () => {
    process.env.LINEAR_OAUTH_CLIENT_ID = 'lin-client';
    process.env.LINEAR_OAUTH_CLIENT_SECRET = 'lin-secret';
    await ensureModuleLoaded();
    const result = await callRoute('post', '/url');
    expect(result.statusCode).toBe(200);
    expect(result.body.url).toContain('https://linear.app/oauth/authorize');
    expect(result.body.url).toContain('client_id=lin-client');
  });

  it('GET /status returns disconnected when no token', async () => {
    mockFindByUserId.mockResolvedValue(undefined);
    await ensureModuleLoaded();
    const result = await callRoute('get', '/status');
    expect(result.body).toEqual({ connected: false });
  });

  it('DELETE /disconnect calls repository delete', async () => {
    mockDelete.mockResolvedValue(true);
    await ensureModuleLoaded();
    const result = await callRoute('delete', '/disconnect');
    expect(result.body).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledWith('u1');
  });
});
