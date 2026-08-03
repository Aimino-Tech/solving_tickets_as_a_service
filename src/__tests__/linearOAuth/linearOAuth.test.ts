import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerChild = vi.hoisted(() => ({
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => mockLoggerChild) },
}));

vi.mock('../../config.js', () => ({
  config: {
    linearOauth: { clientId: 'test-client', clientSecret: 'test-secret' },
    port: 3000,
  },
}));

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-123', email: 'test@example.com' };
    next();
  },
}));

vi.mock('../../auth/service.js', () => ({
  authService: {
    verifyToken: vi.fn().mockResolvedValue({ sub: 'user-123', email: 'test@example.com' }),
    generateTokens: vi.fn().mockReturnValue({
      token: 'at',
      refreshToken: 'rt',
      user: { id: 'user-123', email: 'test@example.com', emailVerified: false, name: 'Test' },
    }),
  },
}));

vi.mock('../../db/repositories/LinearOAuthRepository.js', () => ({
  linearOAuthRepository: {
    findByUserId: vi.fn().mockResolvedValue(undefined),
    findByLinearUserId: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
}));

vi.mock('../../audit/middleware.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'new-user' } } }),
      },
    },
  })),
}));

describe('linear OAuth routes', () => {
  let router: any;
  const mockFetch = vi.fn();

  const mockReqRes = (method: string, path: string, body?: any, query: any = {}) => {
    const req = {
      method,
      path,
      url: path,
      query,
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
      end: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
    };
    return { req, res };
  };

  const matchesPath = (routePath: string, path: string, req: any): boolean => {
    const routeParts = routePath.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (routeParts.length !== pathParts.length) return false;
    for (let i = 0; i < routeParts.length; i++) {
      const routePart = routeParts[i];
      if (routePart.startsWith(':')) {
        req.params[routePart.slice(1)] = pathParts[i];
      } else if (routePart !== pathParts[i]) {
        return false;
      }
    }
    return true;
  };

  const invokeRoute = async (routerImpl: any, method: string, path: string, req: any, res: any) => {
    for (const layer of routerImpl.stack) {
      if (!layer.route) continue;
      const routeMethods = Object.keys(layer.route.methods);
      if (!routeMethods.includes(method.toLowerCase())) continue;
      if (!matchesPath(layer.route.path, path, req)) continue;
      for (const handler of layer.route.stack) {
        await handler.handle(req, res, () => {});
      }
      return;
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt',
        data: { viewer: { id: 'lin-1', name: 'Lin User', email: 'lin@example.com' } },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const mod = await import('../../routes/linearOAuth.js');
    router = mod.linearOAuthRouter;
  });

  it('returns an authorize URL for POST /url', async () => {
    const { req, res } = mockReqRes('POST', '/url');
    await invokeRoute(router, 'POST', '/url', req, res);

    expect(res.json).toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.url).toContain('linear.app/oauth/authorize');
    expect(body.url).toContain('client_id=test-client');
    expect(body.url).toContain('response_type=code');
  });

  it('returns 501 when Linear OAuth is not configured', async () => {
    const { config } = await import('../../config.js');
    (config as any).linearOauth.clientId = '';
    const { req, res } = mockReqRes('POST', '/url');
    await invokeRoute(router, 'POST', '/url', req, res);

    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('not configured') });
  });

  it('redirects to the frontend with the code on GET /callback', async () => {
    const { req, res } = mockReqRes('GET', '/callback', undefined, { code: 'abc', state: 'st' });
    await invokeRoute(router, 'GET', '/callback', req, res);

    expect(res.redirect).toHaveBeenCalled();
    const redirectUrl = (res.redirect as any).mock.calls[0][0];
    expect(redirectUrl).toContain('code=abc');
    expect(redirectUrl).toContain('state=st');
  });

  it('stores the provider token on POST /token', async () => {
    const { req, res } = mockReqRes('POST', '/token', { providerToken: 'x' });
    await invokeRoute(router, 'POST', '/token', req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, linearLogin: 'Lin User' });
    const { linearOAuthRepository } = await import('../../db/repositories/LinearOAuthRepository.js');
    expect(linearOAuthRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        accessTokenEncrypted: 'enc:x',
        linearUserId: 'lin-1',
      }),
    );
  });

  it('exchanges the code and returns tokens on POST /callback', async () => {
    const { req, res } = mockReqRes('POST', '/callback', { code: 'abc' });
    await invokeRoute(router, 'POST', '/callback', req, res);

    expect(res.json).toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.linear).toEqual({ id: 'lin-1', name: 'Lin User', email: 'lin@example.com' });
    expect(body.token).toBe('at');
  });

  it('returns connected:false for GET /status without a stored token', async () => {
    const { req, res } = mockReqRes('GET', '/status');
    await invokeRoute(router, 'GET', '/status', req, res);

    expect(res.json).toHaveBeenCalledWith({ connected: false });
  });

  it('disconnects on DELETE /disconnect', async () => {
    const { req, res } = mockReqRes('DELETE', '/disconnect');
    await invokeRoute(router, 'DELETE', '/disconnect', req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    const { linearOAuthRepository } = await import('../../db/repositories/LinearOAuthRepository.js');
    expect(linearOAuthRepository.delete).toHaveBeenCalledWith('user-123');
  });
});
