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
  config: { security: { adminApiKey: 'admin-test' } },
}));

const mockQueryWithRetry = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

describe('kpi routes', () => {
  let router: any;

  const mockReqRes = (method: string, path: string, query: any = {}) => {
    const req = {
      method,
      path,
      url: path,
      query,
      params: {},
      cookies: {},
      headers: { 'x-admin-key': 'admin-test' },
      body: {},
    };
    const res = {
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
    };
    return { req, res };
  };

  const invokeRoute = async (routerImpl: any, method: string, path: string, req: any, res: any) => {
    for (const layer of routerImpl.stack) {
      if (!layer.route) continue;
      const routeMethods = Object.keys(layer.route.methods);
      if (!routeMethods.includes(method.toLowerCase())) continue;
      if (layer.route.path !== path) continue;
      for (const handler of layer.route.stack) {
        await handler.handle(req, res, () => {});
      }
      return;
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    const mod = await import('../../routes/kpi.js');
    router = mod.kpiRouter;
  });

  it('returns live MRR/LTV for active accounts on GET /revenue', async () => {
    mockQueryWithRetry.mockResolvedValue({
      rows: [{ plan: 'solo' }, { plan: 'team' }, { plan: 'free' }],
    });
    const { req, res } = mockReqRes('GET', '/revenue');
    await invokeRoute(router, 'GET', '/revenue', req, res);

    expect(res.json).toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.mrr).toBe(118);
    expect(body.ltv).toBe(1416);
    expect(body.activePaidAccounts).toBe(2);
    expect(body.generatedAt).toBeDefined();
    expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining("WHERE subscription_status = 'active'"));
  });

  it('rejects requests without a valid x-admin-key on GET /revenue', async () => {
    const { req, res } = mockReqRes('GET', '/revenue');
    delete req.headers['x-admin-key'];
    await invokeRoute(router, 'GET', '/revenue', req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lists snapshot metrics on GET /', async () => {
    mockQueryWithRetry.mockResolvedValue({
      rows: [{ snapshot_date: '2026-01-01', net_revenue_cents: 9900 }],
    });
    const { req, res } = mockReqRes('GET', '/', { days: '30' });
    await invokeRoute(router, 'GET', '/', req, res);

    expect(res.json).toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.metrics).toHaveLength(1);
    expect(body.count).toBe(1);
  });
});
