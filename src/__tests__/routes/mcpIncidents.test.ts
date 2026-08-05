/**
 * Unit tests for OpenSymphony incident MCP proxy routes — src/routes/mcp.ts
 *
 * Tests: GET /mcp/incidents (list), GET /mcp/incidents/:fingerprint (get),
 * POST /mcp/incidents/:fingerprint/trigger, POST /mcp/incidents (report),
 * plus the 502 path when the upstream incident API is unreachable.
 *
 * Strategy: mock the logger, the config (incident proxy settings), and
 * global fetch. Route handlers are invoked via a lightweight harness that
 * resolves `:param` segments, mirroring mcpKeys.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../config.js', () => ({
  config: {
    trackers: { defaultRepoOwner: 'Aimino-Tech', defaultRepoName: 'syntaro' },
    incidents: {
      osBaseUrl: 'https://symphony.aimino.tech',
      osApiKey: 'test-os-key',
      osIncidentToken: 'test-incident-token',
    },
  },
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

// ── Suite ───────────────────────────────────────────────────────────────────

describe('incident MCP proxy routes', () => {
  let router: import('express').Router;
  const mockFetch = vi.fn();

  beforeAll(async () => {
    router = (await import('../../routes/mcp.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  describe('GET /mcp/incidents', () => {
    it('proxies to OS /api/v1/incidents with x-api-key and returns the list', async () => {
      const upstream = { count: 1, incidents: [{ fingerprint: 'f1', title: 'High CPU' }] };
      mockFetch.mockResolvedValueOnce(jsonResponse(upstream));
      const { req, res } = mockReqRes('get', '/mcp/incidents');
      req.query = { severity: 'critical' };

      await invokeRoute(router, 'get', '/mcp/incidents', req, res);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe('https://symphony.aimino.tech/api/v1/incidents?severity=critical');
      expect(init.headers['x-api-key']).toBe('test-os-key');
      expect(res.json).toHaveBeenCalledWith(upstream);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('passes upstream error status through', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
      const { req, res } = mockReqRes('get', '/mcp/incidents');

      await invokeRoute(router, 'get', '/mcp/incidents', req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'boom' });
    });

    it('returns 502 when the upstream API is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const { req, res } = mockReqRes('get', '/mcp/incidents');

      await invokeRoute(router, 'get', '/mcp/incidents', req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Incident API unreachable' }));
    });
  });

  describe('GET /mcp/incidents/:fingerprint', () => {
    it('proxies a single incident lookup', async () => {
      const upstream = { incident: { fingerprint: 'f1', title: 'High CPU' } };
      mockFetch.mockResolvedValueOnce(jsonResponse(upstream));
      const { req, res } = mockReqRes('get', '/mcp/incidents/f1');

      await invokeRoute(router, 'get', '/mcp/incidents/f1', req, res);

      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).toBe('https://symphony.aimino.tech/api/v1/incidents/f1');
      expect(res.json).toHaveBeenCalledWith(upstream);
    });

    it('passes 404 incident_not_found through', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'incident_not_found' }, 404));
      const { req, res } = mockReqRes('get', '/mcp/incidents/nope');

      await invokeRoute(router, 'get', '/mcp/incidents/nope', req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'incident_not_found' });
    });
  });

  describe('POST /mcp/incidents/:fingerprint/trigger', () => {
    it('proxies the trigger and decorates the result', async () => {
      const upstream = { last_dispatched_at: '2026-08-05T10:00:00Z' };
      mockFetch.mockResolvedValueOnce(jsonResponse(upstream));
      const { req, res } = mockReqRes('post', '/mcp/incidents/f1/trigger');

      await invokeRoute(router, 'post', '/mcp/incidents/f1/trigger', req, res);

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe('https://symphony.aimino.tech/api/v1/incidents/f1/trigger');
      expect(init.method).toBe('POST');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'triggered', fingerprint: 'f1' }),
      );
    });

    it('passes 409 in_cooldown through', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'in_cooldown' }, 409));
      const { req, res } = mockReqRes('post', '/mcp/incidents/f1/trigger');

      await invokeRoute(router, 'post', '/mcp/incidents/f1/trigger', req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'in_cooldown' });
    });
  });

  describe('POST /mcp/incidents', () => {
    it('reports an incident with Bearer OS_INCIDENT_TOKEN and forwards x-trace-id', async () => {
      const upstream = { status: 'accepted', trace_id: 'tr-1' };
      mockFetch.mockResolvedValueOnce(jsonResponse(upstream, 201));
      const { req, res } = mockReqRes('post', '/mcp/incidents');
      req.body = { title: 'High CPU', service: 'api', trace_id: 'tr-in' };

      await invokeRoute(router, 'post', '/mcp/incidents', req, res);

      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toBe('https://symphony.aimino.tech/api/v1/incidents');
      expect(init.headers.Authorization).toBe('Bearer test-incident-token');
      expect(init.headers['x-trace-id']).toBe('tr-in');
      expect(init.body).toBe(JSON.stringify({ title: 'High CPU', service: 'api', trace_id: 'tr-in' }));
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(upstream);
    });

    it('returns 502 when OS_INCIDENT_TOKEN is missing', async () => {
      vi.mocked((await import('../../config.js')).config).incidents.osIncidentToken = undefined as never;
      const { req, res } = mockReqRes('post', '/mcp/incidents');
      req.body = { title: 'x', service: 'y' };

      await invokeRoute(router, 'post', '/mcp/incidents', req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining('OS_INCIDENT_TOKEN not configured'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
