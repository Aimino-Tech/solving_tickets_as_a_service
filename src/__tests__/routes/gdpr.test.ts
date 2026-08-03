import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
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

const mockAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../audit/middleware.js', () => ({
  auditLog: mockAuditLog,
}));

import { gdprRouter } from '../../routes/gdpr.js';

describe('gdpr routes (AIM-4496)', () => {
  beforeEach(() => {
    mockQueryWithRetry.mockReset();
    mockQueryWithRetry.mockResolvedValue({ rows: [] });
    mockAuditLog.mockClear();
  });

  it('DELETE /data erases user data and returns 204', async () => {
    mockQueryWithRetry.mockImplementation(async (sql: string) => {
      if (String(sql).includes('WHERE supabase_uid =')) return { rows: [{ id: 7 }] };
      if (String(sql).includes('SELECT id FROM users WHERE id = $1')) return { rows: [{ id: 7 }] };
      if (String(sql).includes('DELETE FROM users')) return { rows: [] };
      return { rows: [] };
    });
    const { req, res } = mockReqRes('DELETE', '/data');
    await invokeRoute(gdprRouter, 'delete', '/data', req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.erasure' }));
  });

  it('DELETE /data returns 404 when no local user row exists', async () => {
    const { req, res } = mockReqRes('DELETE', '/data');
    await invokeRoute(gdprRouter, 'delete', '/data', req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('GET /export returns a portability JSON archive', async () => {
    mockQueryWithRetry.mockImplementation(async (sql: string) => {
      if (String(sql).includes('WHERE supabase_uid =')) return { rows: [{ id: 7 }] };
      if (String(sql).includes('FROM users WHERE')) return { rows: [{ id: 7, email: 'test@example.com' }] };
      return { rows: [{ id: 1 }] };
    });
    const { req, res } = mockReqRes('GET', '/export');
    await invokeRoute(gdprRouter, 'get', '/export', req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    const body = (res.json as any).mock.calls[0][0];
    expect(body.user).toEqual({ id: 7, email: 'test@example.com' });
    expect(body.exportedAt).toBeTruthy();
  });

  it('GET /consent returns preferences (defaults when nothing stored)', async () => {
    const { req, res } = mockReqRes('GET', '/consent');
    await invokeRoute(gdprRouter, 'get', '/consent', req, res);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.preferences.map((p: { key: string }) => p.key)).toEqual([
      'necessary',
      'analytics',
      'marketing',
      'functional',
    ]);
  });

  it('PUT /consent persists a preference and returns updated preferences', async () => {
    const { req, res } = mockReqRes('PUT', '/consent', { key: 'analytics', granted: true });
    await invokeRoute(gdprRouter, 'put', '/consent', req, res);
    expect(mockQueryWithRetry).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO consent_preferences'),
      expect.any(Array),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.consent' }));
    expect((res.json as any).mock.calls[0][0].success).toBe(true);
  });

  it('PUT /consent accepts future-proof keys (ignored, still 200)', async () => {
    const { req, res } = mockReqRes('PUT', '/consent', { key: 'new-future-key', granted: true });
    await invokeRoute(gdprRouter, 'put', '/consent', req, res);
    expect((res.json as any).mock.calls[0][0].success).toBe(true);
  });

  it('PUT /consent rejects an invalid payload with 400', async () => {
    const { req, res } = mockReqRes('PUT', '/consent', { key: 'analytics' });
    await invokeRoute(gdprRouter, 'put', '/consent', req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

function mockReqRes(method: string, path: string, body?: unknown) {
  const req: any = {
    method,
    path,
    url: path,
    query: {},
    params: {},
    cookies: {},
    headers: {},
    body: body ?? {},
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
  const stack = (router as any).stack || [];
  for (const layer of stack) {
    if (layer.route) {
      const routeMethods = layer.route.methods;
      const routePath = layer.route.path;
      if (routeMethods[method] && matchesPath(routePath, path, req)) {
        for (const handler of layer.route.stack) {
          await handler.handle(req, res, () => {});
        }
        return;
      }
    }
  }
}

function matchesPath(routePath: string, requestPath: string, req: any): boolean {
  const routeParts = routePath.split('/');
  const requestParts = requestPath.split('/');
  if (routeParts.length !== requestParts.length) return false;
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) {
      req.params[routeParts[i].slice(1)] = requestParts[i];
    } else if (routeParts[i] !== requestParts[i]) {
      return false;
    }
  }
  return true;
}
