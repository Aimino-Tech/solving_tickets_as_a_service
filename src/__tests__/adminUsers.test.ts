import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyToken, mockGenerateTokens, mockQuery, mockLogAdminAction, mockConfig, mockUpdateUserById } =
  vi.hoisted(() => {
    const mockVerifyToken = vi.fn();
    const mockGenerateTokens = vi.fn();
    const mockQuery = vi.fn();
    const mockLogAdminAction = vi.fn(async () => {});
    const mockUpdateUserById = vi.fn(async () => ({ data: { user: {} }, error: null }));
    const mockConfig = {
      adminSteering: {
        adminEmails: ['allowlisted@test.com'],
        osAdminApiUrl: '',
        osAdminApiKey: '',
        osAdminTimeoutMs: 1000,
      },
    };
    return { mockVerifyToken, mockGenerateTokens, mockQuery, mockLogAdminAction, mockConfig, mockUpdateUserById };
  });

vi.mock('../../src/auth/service.js', () => ({
  authService: {
    verifyToken: mockVerifyToken,
    generateTokens: mockGenerateTokens,
  },
}));

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
  requireConfig: () => mockConfig,
}));

vi.mock('../../src/db/connection.js', () => ({
  queryWithRetry: mockQuery,
}));

vi.mock('../../src/audit/service.js', () => ({
  logAdminAction: mockLogAdminAction,
}));

vi.mock('../../src/auth/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

async function startTestApp(): Promise<{ server: Server; baseUrl: string }> {
  const { adminUsersRouter } = await import('../../src/routes/adminUsers.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { requestId?: string }).requestId = 'test-request';
    next();
  });
  app.use('/api/v1/admin/users', adminUsersRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

describe('routes/adminUsers', () => {
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
    mockGenerateTokens.mockReset();
    mockQuery.mockReset();
    mockConfig.adminSteering.adminEmails = ['allowlisted@test.com'];
  });

  it('returns 401 without Authorization', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/users`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin JWT', async () => {
    mockVerifyToken.mockReturnValue({ sub: TARGET_ID, email: 'user@test.com', role: 'user' });
    // DB fallback finds no admin row
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(403);
  });

  it('allows admin when JWT lacks role but users.role is admin', async () => {
    mockVerifyToken.mockReturnValue({ sub: ADMIN_ID, email: 'admin@test.com' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // resolvePlatformAdminRole
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 403 when impersonating', async () => {
    mockVerifyToken.mockReturnValue({
      sub: TARGET_ID,
      email: 'user@test.com',
      role: 'user',
      purpose: 'impersonation',
      impersonatorId: ADMIN_ID,
      impersonatorEmail: 'admin@test.com',
    });
    const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('impersonating');
  });

  it('lists users for platform admin', async () => {
    mockVerifyToken.mockReturnValue({ sub: ADMIN_ID, email: 'admin@test.com', role: 'admin' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: TARGET_ID,
            email: 'user@test.com',
            name: 'User',
            plan: 'solo',
            role: 'user',
            created_at: new Date('2026-01-01T00:00:00Z'),
          },
        ],
      });

    const res = await fetch(`${baseUrl}/api/v1/admin/users?page=1&limit=20`, {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.users[0].email).toBe('user@test.com');
  });

  it('issues impersonation token and audits', async () => {
    mockVerifyToken.mockReturnValue({ sub: ADMIN_ID, email: 'admin@test.com', role: 'admin' });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: TARGET_ID,
          email: 'user@test.com',
          name: 'User',
          plan: 'free',
          role: 'user',
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });
    mockGenerateTokens.mockReturnValue({
      token: 'imp-token',
      refreshToken: 'imp-refresh',
      user: { id: TARGET_ID, email: 'user@test.com', emailVerified: false, name: 'User', role: 'user' },
    });

    const res = await fetch(`${baseUrl}/api/v1/admin/users/${TARGET_ID}/impersonate`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('imp-token');
    expect(body.impersonator.email).toBe('admin@test.com');
    expect(mockGenerateTokens).toHaveBeenCalledWith(
      TARGET_ID,
      'user@test.com',
      'User',
      'user',
      { impersonatorId: ADMIN_ID, impersonatorEmail: 'admin@test.com' },
    );
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.impersonate.start', resourceId: TARGET_ID }),
    );
  });

  it('blocks nested impersonate via platform admin gate', async () => {
    mockVerifyToken.mockReturnValue({
      sub: TARGET_ID,
      email: 'user@test.com',
      role: 'user',
      purpose: 'impersonation',
      impersonatorId: ADMIN_ID,
      impersonatorEmail: 'admin@test.com',
    });
    const res = await fetch(`${baseUrl}/api/v1/admin/users/${ADMIN_ID}/impersonate`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(403);
    expect(mockGenerateTokens).not.toHaveBeenCalled();
  });

  it('allows exit audit while impersonating', async () => {
    mockVerifyToken.mockReturnValue({
      sub: TARGET_ID,
      email: 'user@test.com',
      role: 'user',
      purpose: 'impersonation',
      impersonatorId: ADMIN_ID,
      impersonatorEmail: 'admin@test.com',
    });
    const res = await fetch(`${baseUrl}/api/v1/admin/users/impersonate/exit`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(200);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.impersonate.exit', adminId: ADMIN_ID }),
    );
  });
});
