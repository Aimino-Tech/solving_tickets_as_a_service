/**
 * Unit tests for Bitbucket OAuth routes — src/routes/bitbucketOAuth.ts
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    req.user = { id: '1', email: 'user@example.com' };
    next();
  }),
);

vi.mock('../../auth/middleware.js', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('../../audit/middleware.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  config: {
    port: 3002,
    bitbucket: {
      username: '',
      appPassword: '',
      webhookSecret: 'test-secret',
      baseUrl: 'https://api.bitbucket.org',
      oauthClientId: 'bb-client-id',
      oauthClientSecret: 'bb-client-secret',
    },
  },
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: (t: string) => `enc:${t}`,
  decrypt: (t: string) => t.replace(/^enc:/, ''),
}));

const mockFindByUserId = vi.hoisted(() => vi.fn());
const mockFindByWorkspace = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock('../../db/repositories/BitbucketConnectionRepository.js', () => ({
  bitbucketConnectionRepository: {
    findByUserId: mockFindByUserId,
    findByWorkspace: mockFindByWorkspace,
    upsert: mockUpsert,
    delete: mockDelete,
  },
}));

const mockListRepos = vi.hoisted(() => vi.fn());
const mockListWorkspaces = vi.hoisted(() => vi.fn());
const mockGetAuthenticatedUser = vi.hoisted(() => vi.fn());

vi.mock('../../platforms/bitbucket/index.js', () => ({
  BitbucketPlatformClient: class {
    listRepos = mockListRepos;
    listWorkspaces = mockListWorkspaces;
    getAuthenticatedUser = mockGetAuthenticatedUser;
  },
}));

function mockReqRes(method: string, path: string) {
  const req: any = {
    headers: {},
    params: {},
    query: {},
    body: {},
    method,
    path,
    user: { id: '1', email: 'user@example.com' },
  };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
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
      if (routeMethods[method] && routePath === path) {
        for (const handler of layer.route.stack) {
          await handler.handle(req, res, () => {});
        }
        return;
      }
    }
  }
  throw new Error(`No route matched ${method} ${path}`);
}

describe('bitbucket OAuth routes', () => {
  let router: import('express').Router;

  beforeAll(async () => {
    router = (await import('../../routes/bitbucketOAuth.js')).bitbucketOAuthRouter;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByUserId.mockResolvedValue(undefined);
    mockFindByWorkspace.mockResolvedValue(undefined);
    mockUpsert.mockResolvedValue({
      userId: '1',
      username: 'bbuser',
      workspace: 'ws',
      authMethod: 'oauth',
    });
    mockGetAuthenticatedUser.mockResolvedValue('bbuser');
    mockListWorkspaces.mockResolvedValue([{ slug: 'ws', name: 'WS' }]);
    mockListRepos.mockResolvedValue([{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('access_token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'oauth-access',
              refresh_token: 'oauth-refresh',
              expires_in: 3600,
              scopes: 'account repository',
            }),
          };
        }
        if (String(url).includes('/user')) {
          return {
            ok: true,
            json: async () => ({ username: 'bbuser', uuid: '{u}' }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });

  it('POST /url returns Bitbucket authorize URL', async () => {
    const { req, res } = mockReqRes('POST', '/url');
    await invokeRoute(router, 'post', '/url', req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('https://bitbucket.org/site/oauth2/authorize'),
      }),
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.url).toContain('client_id=bb-client-id');
  });

  it('GET /callback redirects to settings with bitbucket_code', async () => {
    const { req, res } = mockReqRes('GET', '/callback');
    req.query = { code: 'abc123', state: 's1' };
    await invokeRoute(router, 'get', '/callback', req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/settings?bitbucket_code=abc123'),
    );
  });

  it('POST /callback exchanges code and upserts oauth connection', async () => {
    const { req, res } = mockReqRes('POST', '/callback');
    req.body = { code: 'abc123' };
    await invokeRoute(router, 'post', '/callback', req, res);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '1',
        workspace: 'ws',
        authMethod: 'oauth',
        appPasswordEncrypted: 'enc:oauth-access',
        refreshTokenEncrypted: 'enc:oauth-refresh',
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        connected: true,
        workspace: 'ws',
        authMethod: 'oauth',
      }),
    );
  });
});
