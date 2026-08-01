/**
 * Unit tests for GDPR privacy routes — src/routes/privacy.ts
 *
 * Tests:
 *   - DELETE /erasure right-to-erasure (204)
 *   - GET /portability data portability archive
 *   - GET/PUT /preferences cookie consent
 *   - POST /anonymize data anonymization
 *
 * Strategy:
 *   Mock the logger, auth middleware, supabase admin client, db connection,
 *   and audit middleware. Import the router and test via a lightweight
 *   request/response harness.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockLoggerChild = vi.hoisted(() =>
  vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
);

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: mockLoggerChild },
}));

const mockRequireAuth = vi.hoisted(() =>
  vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com' };
    next();
  }),
);

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: mockRequireAuth,
}));

const mockSupabaseAdmin = vi.hoisted(() => ({
  auth: {
    admin: {
      getUserById: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'test@example.com',
            user_metadata: { name: 'Test' },
            app_metadata: { plan: 'solo' },
            created_at: '2024-01-01T00:00:00Z',
          },
        },
      }),
      deleteUser: vi.fn().mockResolvedValue({ error: null }),
      updateUserById: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabaseAdmin),
}));

const mockQueryWithRetry = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

const mockAuditLog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../audit/middleware.js', () => ({
  auditLog: mockAuditLog,
}));

// ── Suite ───────────────────────────────────────────────────────────────────

describe('privacy routes', () => {
  let router: import('express').Router;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../routes/privacy.js');
    router = mod.default;
  });

  // ── DELETE /erasure ─────────────────────────────────────────────────────

  describe('DELETE /erasure', () => {
    it('deletes the user data and returns 204', async () => {
      const { req, res } = mockReqRes('DELETE', '/erasure');

      await invokeRoute(router, 'delete', '/erasure', req, res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(mockSupabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('user-123');
      expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users'), ['user-123']);
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.erasure' }));
    });

    it('returns 500 when supabase deletion fails', async () => {
      mockSupabaseAdmin.auth.admin.deleteUser.mockResolvedValueOnce({
        error: new Error('supabase down'),
      });
      const { req, res } = mockReqRes('DELETE', '/erasure');

      await invokeRoute(router, 'delete', '/erasure', req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });
  });

  // ── GET /portability ─────────────────────────────────────────────────────

  describe('GET /portability', () => {
    it('returns a JSON archive containing the user profile', async () => {
      const { req, res } = mockReqRes('GET', '/portability');

      await invokeRoute(router, 'get', '/portability', req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('privacy-export-user-123-'),
      );
      const body = (res.json as any).mock.calls[0][0];
      expect(body.profile).toEqual(expect.objectContaining({ id: 'user-123', email: 'test@example.com' }));
      expect(body.compliance).toEqual(expect.objectContaining({ gdprCompliant: true }));
    });
  });

  // ── GET/PUT /preferences ─────────────────────────────────────────────────

  describe('consent preferences', () => {
    it('GET returns default consent when nothing stored', async () => {
      const { req, res } = mockReqRes('GET', '/preferences');

      await invokeRoute(router, 'get', '/preferences', req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        consent: { necessary: true, analytics: false, marketing: false, functional: false },
      });
    });

    it('PUT persists consent choices', async () => {
      const { req, res } = mockReqRes('PUT', '/preferences');
      req.body = { analytics: true, marketing: false };

      await invokeRoute(router, 'put', '/preferences', req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        consent: { necessary: true, analytics: true, marketing: false, functional: false },
      });
      expect(mockQueryWithRetry).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO consent_preferences'), [
        'user-123',
        true,
        false,
        false,
      ]);
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.consent.update' }));
    });

    it('PUT rejects invalid payloads with 400', async () => {
      const { req, res } = mockReqRes('PUT', '/preferences');
      req.body = { analytics: 'yes' };

      await invokeRoute(router, 'put', '/preferences', req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockQueryWithRetry).not.toHaveBeenCalled();
    });
  });

  // ── POST /anonymize ──────────────────────────────────────────────────────

  describe('POST /anonymize', () => {
    it('hashes the email and returns anonymized:true', async () => {
      const { req, res } = mockReqRes('POST', '/anonymize');

      await invokeRoute(router, 'post', '/anonymize', req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ anonymized: true });

      // Find the users UPDATE call and verify the email is hashed.
      const updateCall = mockQueryWithRetry.mock.calls.find((call: any[]) => call[0].includes('UPDATE users'));
      expect(updateCall).toBeDefined();
      const hashedEmail = updateCall![1][0];
      expect(hashedEmail).toMatch(/^[a-f0-9]{64}$/);
      expect(hashedEmail).not.toBe('test@example.com');
      expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.anonymize' }));
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
    body: {},
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
