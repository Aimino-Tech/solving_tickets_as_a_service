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

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = { id: 'user-123', email: 'test@example.com' };
    next();
  },
}));

const mockQueryWithRetry = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

describe('invite routes', () => {
  let router: any;

  const mockReqRes = (method: string, path: string, body?: any) => {
    const req = { method, path, url: path, query: {}, params: {}, cookies: {}, headers: {}, body };
    const res = {
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
    };
    return { req, res };
  };

  const invokeRoute = async (routerImpl: any, method: string, path: string, req: any, res: any) => {
    for (const layer of routerImpl.stack) {
      if (!layer.route) continue;
      const routeMethods = Object.keys(layer.route.methods);
      if (!routeMethods.includes(method.toLowerCase())) continue;
      for (const handler of layer.route.stack) {
        await handler.handle(req, res, () => {});
      }
      return;
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    const mod = await import('../../routes/invites.js');
    router = mod.inviteRouter;
  });

  it('creates an invite for a valid email', async () => {
    const { req, res } = mockReqRes('POST', '/', { email: 'new@example.com' });
    await invokeRoute(router, 'POST', '/', req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ invited: true, email: 'new@example.com' });
    expect(mockQueryWithRetry).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO invites'),
      expect.arrayContaining(['new@example.com', 'user-123', 'member', expect.any(String)]),
    );
  });

  it('returns 400 for an invalid email', async () => {
    const { req, res } = mockReqRes('POST', '/', { email: 'not-an-email' });
    await invokeRoute(router, 'POST', '/', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQueryWithRetry).not.toHaveBeenCalled();
  });

  it('lists invites for the authenticated user', async () => {
    mockQueryWithRetry.mockResolvedValue({
      rows: [{ id: 1, email: 'new@example.com', role: 'member', status: 'pending' }],
    });
    const { req, res } = mockReqRes('GET', '/');
    await invokeRoute(router, 'GET', '/', req, res);

    expect(res.json).toHaveBeenCalledWith({
      invites: [{ id: 1, email: 'new@example.com', role: 'member', status: 'pending' }],
    });
    expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining('FROM invites WHERE invited_by = $1'), [
      'user-123',
    ]);
  });
});
