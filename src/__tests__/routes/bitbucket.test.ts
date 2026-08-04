/**
 * Unit tests for Bitbucket workspace routes — src/routes/bitbucket.ts
 *
 * Connect accepts apiToken + optional email (defaults to authenticated user),
 * workspace is auto-detected via Bitbucket API.
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

vi.mock('../../config.js', () => ({
  config: {
    bitbucket: {
      username: '',
      appPassword: '',
      webhookSecret: 'test-secret',
      baseUrl: 'https://api.bitbucket.org',
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
const mockListWebhooks = vi.hoisted(() => vi.fn());
const mockCreateWebhook = vi.hoisted(() => vi.fn());
const mockRemoveWebhook = vi.hoisted(() => vi.fn());

vi.mock('../../platforms/bitbucket/index.js', () => ({
  BitbucketPlatformClient: class {
    listRepos = mockListRepos;
    listWorkspaces = mockListWorkspaces;
    getAuthenticatedUser = mockGetAuthenticatedUser;
    listWebhooks = mockListWebhooks;
    createWebhook = mockCreateWebhook;
    removeWebhook = mockRemoveWebhook;
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

const connectedRow = {
  userId: '1',
  username: 'user@example.com',
  appPasswordEncrypted: 'enc:p',
  workspace: 'ws',
  authMethod: 'api_token' as const,
  refreshTokenEncrypted: null,
  bitbucketUuid: null,
  scope: null,
  tokenExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('bitbucket routes', () => {
  let router: import('express').Router;

  beforeAll(async () => {
    router = (await import('../../routes/bitbucket.js')).bitbucketRouter;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByUserId.mockResolvedValue(undefined);
    mockFindByWorkspace.mockResolvedValue(undefined);
    mockUpsert.mockResolvedValue(connectedRow);
    mockDelete.mockResolvedValue(true);
    mockGetAuthenticatedUser.mockResolvedValue('bb-user');
    mockListWorkspaces.mockResolvedValue([{ slug: 'ws', name: 'WS' }]);
    mockListRepos.mockResolvedValue([]);
  });

  describe('GET /status', () => {
    it('reports disconnected when no row for user', async () => {
      const { req, res } = mockReqRes('GET', '/status');
      await invokeRoute(router, 'get', '/status', req, res);
      expect(mockFindByUserId).toHaveBeenCalledWith('1');
      expect(res.json).toHaveBeenCalledWith({ connected: false, workspace: '', username: null, authMethod: null });
    });

    it('reports connected from DB row', async () => {
      mockFindByUserId.mockResolvedValue(connectedRow);
      const { req, res } = mockReqRes('GET', '/status');
      await invokeRoute(router, 'get', '/status', req, res);
      expect(res.json).toHaveBeenCalledWith({
        connected: true,
        workspace: 'ws',
        username: 'user@example.com',
        authMethod: 'api_token',
      });
    });
  });

  describe('POST /connect', () => {
    it('rejects when apiToken is missing', async () => {
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = {};
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('connects with apiToken only and upserts using user email', async () => {
      mockListRepos.mockResolvedValue([{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main' }]);
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { apiToken: 'ATATT3xxxxxxxxxxxxxxxxxxxx' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(mockUpsert).toHaveBeenCalledWith({
        userId: '1',
        username: 'user@example.com',
        appPasswordEncrypted: 'enc:ATATT3xxxxxxxxxxxxxxxxxxxx',
        workspace: 'ws',
        authMethod: 'api_token',
        refreshTokenEncrypted: null,
        bitbucketUuid: null,
        scope: null,
        tokenExpiresAt: null,
      });
      expect(res.json).toHaveBeenCalledWith({
        connected: true,
        workspace: 'ws',
        repoCount: 1,
        workspaces: ['ws'],
        emailUsed: 'user@example.com',
      });
    });

    it('uses email override from body when provided', async () => {
      mockListRepos.mockResolvedValue([{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main' }]);
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { apiToken: 'ATATT3xxxxxxxxxxxxxxxxxxxx', email: 'atlassian@example.com' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(mockUpsert).toHaveBeenCalledWith({
        userId: '1',
        username: 'atlassian@example.com',
        appPasswordEncrypted: 'enc:ATATT3xxxxxxxxxxxxxxxxxxxx',
        workspace: 'ws',
        authMethod: 'api_token',
        refreshTokenEncrypted: null,
        bitbucketUuid: null,
        scope: null,
        tokenExpiresAt: null,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          connected: true,
          emailUsed: 'atlassian@example.com',
        }),
      );
    });

    it('returns 409 when workspace belongs to another user', async () => {
      mockFindByWorkspace.mockResolvedValue({ ...connectedRow, userId: 'other' });
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { apiToken: 'ATATT3xxxxxxxxxxxxxxxxxxxx' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('returns 400 with Bitbucket scopes message when verification fails', async () => {
      const scopesErr = Object.assign(new Error('Bitbucket API error'), {
        bitbucketMessage: 'API Token provided has no Bitbucket scopes',
      });
      mockGetAuthenticatedUser.mockRejectedValue(scopesErr);
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { apiToken: 'bad-token-bad-token-bad' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('no Bitbucket scopes'),
          emailUsed: 'user@example.com',
        }),
      );
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('returns 400 when verification fails with generic error', async () => {
      mockGetAuthenticatedUser.mockRejectedValue(new Error('Unauthorized'));
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { apiToken: 'bad-token-bad-token-bad' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /disconnect', () => {
    it('deletes the current user connection', async () => {
      const { req, res } = mockReqRes('DELETE', '/disconnect');
      await invokeRoute(router, 'delete', '/disconnect', req, res);
      expect(mockDelete).toHaveBeenCalledWith('1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('GET /repos', () => {
    it('lists repos with webhook status after connect', async () => {
      mockFindByUserId.mockResolvedValue(connectedRow);
      mockListRepos.mockResolvedValue([{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main' }]);
      mockListWebhooks.mockResolvedValue([{ uuid: '{h}', url: 'https://api.syntaro.io/webhook/bitbucket', active: true }]);

      const { req, res } = mockReqRes('GET', '/repos');
      await invokeRoute(router, 'get', '/repos', req, res);
      expect(res.json).toHaveBeenCalledWith({
        connected: true,
        workspace: 'ws',
        repos: [{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main', webhookActive: true }],
      });
    });

    it('returns empty when user has no connection', async () => {
      const { req, res } = mockReqRes('GET', '/repos');
      await invokeRoute(router, 'get', '/repos', req, res);
      expect(res.json).toHaveBeenCalledWith({ connected: false, repos: [] });
    });
  });

  describe('POST /repos/:owner/:repo/webhook', () => {
    it('creates a webhook pointing at the SYNTARO endpoint', async () => {
      mockFindByUserId.mockResolvedValue(connectedRow);
      mockCreateWebhook.mockResolvedValue({ uuid: '{new-hook}' });

      const { req, res } = mockReqRes('POST', '/repos/ws/repo-a/webhook');
      await invokeRoute(router, 'post', '/repos/ws/repo-a/webhook', req, res);
      expect(mockCreateWebhook).toHaveBeenCalledWith('ws', 'repo-a', expect.stringContaining('/webhook/bitbucket'), 'test-secret');
      expect(res.json).toHaveBeenCalledWith({ success: true, webhookUuid: '{new-hook}' });
    });
  });

  describe('DELETE /repos/:owner/:repo/webhook', () => {
    it('removes the first matching SYNTARO webhook', async () => {
      mockFindByUserId.mockResolvedValue(connectedRow);
      mockListWebhooks.mockResolvedValue([
        { uuid: '{target}', url: 'https://api.syntaro.io/webhook/bitbucket', active: true },
        { uuid: '{other}', url: 'https://example.com/hook', active: true },
      ]);
      mockRemoveWebhook.mockResolvedValue(undefined);

      const { req, res } = mockReqRes('DELETE', '/repos/ws/repo-a/webhook');
      await invokeRoute(router, 'delete', '/repos/ws/repo-a/webhook', req, res);
      expect(mockRemoveWebhook).toHaveBeenCalledWith('ws', 'repo-a', '{target}');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
