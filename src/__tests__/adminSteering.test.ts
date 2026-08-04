import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyToken, mockFetch, realFetch, mockConfig, osResponse } = vi.hoisted(() => {
  const mockVerifyToken = vi.fn();
  const mockFetch = vi.fn();
  const realFetch = globalThis.fetch.bind(globalThis);
  const osResponse = { current: undefined as { ok: boolean; status: number; text: () => Promise<string> } | undefined };
  const mockConfig = {
    adminSteering: {
      adminEmails: ['admin@test.com'],
      osAdminApiUrl: 'http://os-admin.test',
      osAdminApiKey: 'os-secret-key',
      osAdminTimeoutMs: 1000,
    },
  };
  return { mockVerifyToken, mockFetch, realFetch, mockConfig, osResponse };
});

vi.mock('../../src/auth/service.js', () => ({
  authService: { verifyToken: mockVerifyToken },
}));

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
  requireConfig: () => mockConfig,
}));

vi.mock('../../src/audit/service.js', () => ({
  logAdminAction: vi.fn(async () => {}),
}));

vi.stubGlobal('fetch', mockFetch);

// The test's own HTTP calls hit the local test server (pass through to the real
// fetch); the router's OS forward calls return the per-test osResponse fixture.
mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('http://127.0.0.1')) {
    return realFetch(input as RequestInfo, init);
  }
  if (osResponse.current) {
    return osResponse.current;
  }
  throw new Error(`Unexpected non-local fetch in test: ${url}`);
});

async function startTestApp(): Promise<{ server: Server; baseUrl: string }> {
  const { adminSteeringRouter } = await import('../../src/routes/adminSteering.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { requestId?: string }).requestId = 'test-request';
    next();
  });
  app.use('/api/v1/admin/steering', adminSteeringRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const okJson = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });

describe('routes/adminSteering auth gate', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await startTestApp();
    server = app.server;
    baseUrl = app.baseUrl;
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockReset();
    mockFetch.mockClear();
    osResponse.current = undefined;
    mockConfig.adminSteering.adminEmails = ['admin@test.com'];
    mockConfig.adminSteering.osAdminApiUrl = 'http://os-admin.test';
    mockConfig.adminSteering.osAdminApiKey = 'os-secret-key';
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Authentication required');
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('os-admin.test'), expect.anything());
  });

  it('returns 401 when the JWT is invalid', async () => {
    mockVerifyToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer bad.jwt.token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid or expired token');
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('os-admin.test'), expect.anything());
  });

  it('returns 403 when the JWT email is not in ADMIN_EMAILS and role is not admin', async () => {
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'user@test.com', role: 'user' });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('not an administrator');
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('os-admin.test'), expect.anything());
  });

  it('allows access when JWT role is admin even if ADMIN_EMAILS is empty', async () => {
    mockConfig.adminSteering.adminEmails = [];
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'hello@syntaro.io', role: 'admin' });
    osResponse.current = okJson({ status: 'ok', proxy: 'running', emergency_paused: false });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('returns 403 when impersonating even with admin role on target', async () => {
    mockVerifyToken.mockReturnValue({
      sub: '42',
      email: 'user@test.com',
      role: 'admin',
      purpose: 'impersonation',
      impersonatorId: 'admin-1',
      impersonatorEmail: 'admin@test.com',
    });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('impersonating');
  });

  it('returns 403 when ADMIN_EMAILS is empty and role is not admin', async () => {
    mockConfig.adminSteering.adminEmails = [];
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'user@test.com', role: 'user' });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('not an administrator');
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('os-admin.test'), expect.anything());
  });

  it('forwards GET /health to the OS admin API and returns its body', async () => {
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'admin@test.com' });
    osResponse.current = okJson({ status: 'ok', proxy: 'running', emergency_paused: false });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.emergency_paused).toBe(false);
    const [url, opts] = mockFetch.mock.calls.find(([u]) => String(u).includes('os-admin.test')) as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://os-admin.test/api/v1/admin/health');
    expect(opts.method).toBe('GET');
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('os-secret-key');
  });

  it('forwards POST /tenant/:id/kill with x-api-key and JSON body', async () => {
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'admin@test.com' });
    osResponse.current = okJson({ status: 'killed', tenant_id: 'acme' });
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/tenant/acme/kill`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt.token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'abuse' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('killed');
    const [url, opts] = mockFetch.mock.calls.find(([u]) => String(u).includes('os-admin.test')) as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://os-admin.test/api/v1/admin/tenant/acme/kill');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('os-secret-key');
    expect(opts.body).toBe(JSON.stringify({ reason: 'abuse' }));
  });

  it('returns 503 with explicit error when OS_ADMIN_API_URL is unset', async () => {
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'admin@test.com' });
    mockConfig.adminSteering.osAdminApiUrl = '';
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('OS_ADMIN_API_URL');
  });

  it('treats an OS 401 as a proxy error (502)', async () => {
    mockVerifyToken.mockReturnValue({ sub: '42', email: 'admin@test.com' });
    osResponse.current = {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'unauthorized' }),
    };
    const res = await fetch(`${baseUrl}/api/v1/admin/steering/health`, {
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain('rejected the proxy credential');
  });
});
