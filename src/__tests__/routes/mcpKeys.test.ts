/**
 * Unit tests for MCP API key management routes — src/routes/mcpKeys.ts
 *
 * Tests: GET / (list), POST / (create, key shown once), PATCH /:id (rename),
 * DELETE /:id (revoke soft-delete), plus zod validation (400) and ownership
 * enforcement (404).
 *
 * Strategy: mock the logger, requireAuth (injects req.user), and the
 * mcpKeys service. Route handlers are invoked via a lightweight harness.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

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
    req.user = { id: '1' };
    next();
  }),
);

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: mockRequireAuth,
}));

const mockCreateMcpKey = vi.hoisted(() => vi.fn());
const mockListMcpKeys = vi.hoisted(() => vi.fn());
const mockRenameMcpKey = vi.hoisted(() => vi.fn());
const mockRevokeMcpKey = vi.hoisted(() => vi.fn());

vi.mock('../../services/mcpKeys.js', () => ({
  createMcpKey: mockCreateMcpKey,
  listMcpKeys: mockListMcpKeys,
  renameMcpKey: mockRenameMcpKey,
  revokeMcpKey: mockRevokeMcpKey,
}));

// ── Harness ─────────────────────────────────────────────────────────────────

function mockReqRes(method: string, path: string) {
  const req: any = { headers: {}, params: {}, query: {}, body: {}, method, path };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  return { req, res };
}

async function invokeRoute(router: import('express').Router, method: string, path: string, req: any, res: any): Promise<void> {
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
  throw new Error(`No route matched ${method} ${path}`);
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

const baseRecord = {
  id: 'k-1',
  userId: '1',
  name: 'agent',
  keyPrefix: 'sk-stas_12345678',
  createdAt: '2026-07-31T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

// ── Suite ───────────────────────────────────────────────────────────────────

describe('mcpKeys routes', () => {
  let router: import('express').Router;

  beforeAll(async () => {
    router = (await import('../../routes/mcpKeys.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns the authenticated user’s keys', async () => {
      mockListMcpKeys.mockResolvedValue([baseRecord]);
      const { req, res } = mockReqRes('GET', '/');
      await invokeRoute(router, 'get', '/', req, res);
      expect(mockListMcpKeys).toHaveBeenCalledWith('1');
      expect(res.json).toHaveBeenCalledWith({ keys: [baseRecord] });
    });

    it('returns 500 when the service throws', async () => {
      mockListMcpKeys.mockRejectedValue(new Error('db down'));
      const { req, res } = mockReqRes('GET', '/');
      await invokeRoute(router, 'get', '/', req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('POST /', () => {
    it('creates a key and returns the full key exactly once with 201', async () => {
      mockCreateMcpKey.mockResolvedValue({ record: baseRecord, key: 'sk-stas_1234567890abcdef1234567890abcdef' });
      const { req, res } = mockReqRes('POST', '/');
      req.body = { name: 'my-agent' };
      await invokeRoute(router, 'post', '/', req, res);
      expect(mockCreateMcpKey).toHaveBeenCalledWith('1', 'my-agent');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        id: 'k-1',
        name: 'agent',
        keyPrefix: 'sk-stas_12345678',
        key: 'sk-stas_1234567890abcdef1234567890abcdef',
        createdAt: '2026-07-31T00:00:00.000Z',
      });
    });

    it('returns 400 for an empty name', async () => {
      const { req, res } = mockReqRes('POST', '/');
      req.body = { name: '   ' };
      await invokeRoute(router, 'post', '/', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreateMcpKey).not.toHaveBeenCalled();
    });

    it('returns 400 for a name longer than 64 chars', async () => {
      const { req, res } = mockReqRes('POST', '/');
      req.body = { name: 'x'.repeat(65) };
      await invokeRoute(router, 'post', '/', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreateMcpKey).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /:id', () => {
    it('renames a key owned by the user', async () => {
      mockRenameMcpKey.mockResolvedValue({ ...baseRecord, name: 'renamed' });
      const { req, res } = mockReqRes('PATCH', '/k-1');
      req.body = { name: 'renamed' };
      await invokeRoute(router, 'patch', '/k-1', req, res);
      expect(mockRenameMcpKey).toHaveBeenCalledWith('1', 'k-1', 'renamed');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'k-1', name: 'renamed' }));
    });

    it('returns 404 when the key does not belong to the user', async () => {
      mockRenameMcpKey.mockResolvedValue(null);
      const { req, res } = mockReqRes('PATCH', '/k-other');
      req.body = { name: 'x' };
      await invokeRoute(router, 'patch', '/k-other', req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Key not found' });
    });

    it('returns 400 for invalid body', async () => {
      const { req, res } = mockReqRes('PATCH', '/k-1');
      req.body = { name: '' };
      await invokeRoute(router, 'patch', '/k-1', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('DELETE /:id', () => {
    it('revokes a key owned by the user and returns 204', async () => {
      mockRevokeMcpKey.mockResolvedValue(true);
      const { req, res } = mockReqRes('DELETE', '/k-1');
      await invokeRoute(router, 'delete', '/k-1', req, res);
      expect(mockRevokeMcpKey).toHaveBeenCalledWith('1', 'k-1');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });

    it('returns 404 when the key is not owned by the user', async () => {
      mockRevokeMcpKey.mockResolvedValue(false);
      const { req, res } = mockReqRes('DELETE', '/k-other');
      await invokeRoute(router, 'delete', '/k-other', req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
