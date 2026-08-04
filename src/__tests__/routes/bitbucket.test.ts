/**
 * Unit tests for Bitbucket workspace routes — src/routes/bitbucket.ts
 *
 * Tests: GET /status, POST /connect (validates via listRepos), DELETE
 * /disconnect, GET /repos (lists repos + webhook status), POST/DELETE
 * /repos/:owner/:repo/webhook.
 *
 * Strategy: mock the logger, requireAuth, config, and the BitbucketPlatformClient.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../config.js', () => ({
  config: {
    bitbucket: {
      clientId: '',
      clientSecret: '',
      workspace: '',
      webhookSecret: 'test-secret',
      baseUrl: 'https://api.bitbucket.org',
      tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
    },
  },
}));

const mockListRepos = vi.hoisted(() => vi.fn());
const mockListWebhooks = vi.hoisted(() => vi.fn());
const mockCreateWebhook = vi.hoisted(() => vi.fn());
const mockRemoveWebhook = vi.hoisted(() => vi.fn());
const mockFetchToken = vi.hoisted(() => vi.fn());

vi.mock('../../platforms/bitbucket/index.js', () => ({
  BitbucketPlatformClient: class {
    listRepos = mockListRepos;
    listWebhooks = mockListWebhooks;
    createWebhook = mockCreateWebhook;
    removeWebhook = mockRemoveWebhook;
  },
}));

vi.mock('../../platforms/bitbucket/oauth.js', () => ({
  fetchBitbucketToken: mockFetchToken,
}));

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

describe('bitbucket routes', () => {
  let router: import('express').Router;

  beforeAll(async () => {
    router = (await import('../../routes/bitbucket.js')).bitbucketRouter;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchToken.mockResolvedValue({ access_token: 'test-token', expires_in: 3600, token_type: 'bearer' });
  });

  describe('GET /status', () => {
    it('reports disconnected when no credentials are configured', async () => {
      const { req, res } = mockReqRes('GET', '/status');
      await invokeRoute(router, 'get', '/status', req, res);
      expect(res.json).toHaveBeenCalledWith({
        connected: false,
        workspace: '',
        clientId: null,
        scopes: expect.any(Array),
        marketplaceUrl: expect.any(String),
      });
    });
  });

  describe('POST /connect', () => {
    it('rejects when fields are missing', async () => {
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { clientId: 'u' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('connects when Marketplace app credentials verify against the workspace', async () => {
      mockListRepos.mockResolvedValue([{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main' }]);
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { clientId: 'app-id', clientSecret: 'app-secret', workspace: 'ws' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(mockFetchToken).toHaveBeenCalledWith('app-id', 'app-secret', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith({ connected: true, workspace: 'ws', repoCount: 1 });
    });

    it('returns 401 when verification fails', async () => {
      mockFetchToken.mockRejectedValue(new Error('invalid_client'));
      const { req, res } = mockReqRes('POST', '/connect');
      req.body = { clientId: 'app-id', clientSecret: 'bad-secret', workspace: 'ws' };
      await invokeRoute(router, 'post', '/connect', req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('GET /repos', () => {
    it('lists repos with webhook status after connect', async () => {
      mockListRepos.mockResolvedValue([{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main' }]);
      mockListWebhooks.mockResolvedValue([{ uuid: '{h}', url: 'https://api.syntaro.io/webhook/bitbucket', active: true }]);

      const connect = mockReqRes('POST', '/connect');
      connect.req.body = { clientId: 'app-id', clientSecret: 'app-secret', workspace: 'ws' };
      await invokeRoute(router, 'post', '/connect', connect.req, connect.res);

      const { req, res } = mockReqRes('GET', '/repos');
      await invokeRoute(router, 'get', '/repos', req, res);
      expect(res.json).toHaveBeenCalledWith({
        connected: true,
        workspace: 'ws',
        repos: [{ name: 'repo-a', fullName: 'ws/repo-a', private: false, mainbranch: 'main', webhookActive: true }],
      });
    });
  });

  describe('POST /repos/:owner/:repo/webhook', () => {
    it('creates a webhook pointing at the SYNTARO endpoint', async () => {
      mockCreateWebhook.mockResolvedValue({ uuid: '{new-hook}' });
      const connect = mockReqRes('POST', '/connect');
      connect.req.body = { clientId: 'app-id', clientSecret: 'app-secret', workspace: 'ws' };
      await invokeRoute(router, 'post', '/connect', connect.req, connect.res);

      const { req, res } = mockReqRes('POST', '/repos/ws/repo-a/webhook');
      await invokeRoute(router, 'post', '/repos/ws/repo-a/webhook', req, res);
      expect(mockCreateWebhook).toHaveBeenCalledWith('ws', 'repo-a', expect.stringContaining('/webhook/bitbucket'), 'test-secret');
      expect(res.json).toHaveBeenCalledWith({ success: true, webhookUuid: '{new-hook}' });
    });
  });

  describe('DELETE /repos/:owner/:repo/webhook', () => {
    it('removes the first matching SYNTARO webhook', async () => {
      mockListWebhooks.mockResolvedValue([
        { uuid: '{target}', url: 'https://api.syntaro.io/webhook/bitbucket', active: true },
        { uuid: '{other}', url: 'https://example.com/hook', active: true },
      ]);
      mockRemoveWebhook.mockResolvedValue(undefined);
      const connect = mockReqRes('POST', '/connect');
      connect.req.body = { clientId: 'app-id', clientSecret: 'app-secret', workspace: 'ws' };
      await invokeRoute(router, 'post', '/connect', connect.req, connect.res);

      const { req, res } = mockReqRes('DELETE', '/repos/ws/repo-a/webhook');
      await invokeRoute(router, 'delete', '/repos/ws/repo-a/webhook', req, res);
      expect(mockRemoveWebhook).toHaveBeenCalledWith('ws', 'repo-a', '{target}');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
