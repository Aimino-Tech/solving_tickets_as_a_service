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

const mockAuthMiddleware = vi.hoisted(() => ({
  optionalAuth: (req: any, _res: any, next: () => void) => {
    const header = req.headers?.authorization;
    if (header?.startsWith('Bearer ')) {
      req.user = { id: 'user-123', email: 'test@example.com' };
    }
    next();
  },
}));
vi.mock('../../auth/middleware.js', () => mockAuthMiddleware);

const mockService = vi.hoisted(() => ({
  createTeam: vi.fn(),
  listTeams: vi.fn(),
  getTeamDetails: vi.fn(),
  inviteMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  getMyTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  setMemberMonthlyLimit: vi.fn(),
  inviteByEmail: vi.fn(),
  revokeInvite: vi.fn(),
  hasRole: vi.fn(),
}));
vi.mock('../../team/index.js', () => mockService);

const mockQueryWithRetry = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

describe('team member routes (AIM-4642)', () => {
  let router: any;

  const mockReqRes = (method: string, path: string, options: any = {}) => {
    const req = {
      method,
      path,
      url: path,
      query: {},
      params: {},
      headers: {},
      body: options.body,
      requestId: 'corr-1',
    };
    const res = {
      statusCode: 200,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
    };
    return { req, res };
  };

  const invokeRoute = async (method: string, path: string, req: any, res: any) => {
    for (const layer of router.stack) {
      if (layer.route) {
        const routeMethods = Object.keys(layer.route.methods);
        if (!routeMethods.includes(method.toLowerCase())) continue;
        if (!pathMatches(layer.route.path, path)) continue;
        req.params = extractParams(layer.route.path, path);
        for (const handler of layer.route.stack) {
          await handler.handle(req, res, () => {});
        }
        return;
      }
      // Non-route middleware (e.g. optionalAuth) applies to every request.
      if (typeof layer.handle === 'function') {
        await new Promise<void>((resolve) => {
          layer.handle(req, res, resolve);
        });
      }
    }
    throw new Error(`No route matched ${method} ${path}`);
  };

  const extractParams = (routePath: string, path: string) => {
    const params: Record<string, string> = {};
    const routeSegments = routePath.split('/').filter(Boolean);
    const pathSegments = path.split('/').filter(Boolean);
    routeSegments.forEach((seg, i) => {
      if (seg.startsWith(':')) params[seg.slice(1)] = pathSegments[i];
    });
    return params;
  };

  const pathMatches = (routePath: string, path: string) => {
    const routeSegments = routePath.split('/').filter(Boolean);
    const pathSegments = path.split('/').filter(Boolean);
    if (routeSegments.length !== pathSegments.length) return false;
    return routeSegments.every((seg, i) => seg.startsWith(':') || seg === pathSegments[i]);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 7 }] });
    mockService.hasRole.mockResolvedValue(true);
    const mod = await import('../../team/routes.js');
    router = mod.teamRouter;
  });

  it('GET /me returns the caller team with role', async () => {
    mockService.getMyTeam.mockResolvedValue({
      team: { id: 1, name: 'Acme' },
      role: 'admin',
    });
    const { req, res } = mockReqRes('GET', '/me');
    req.headers.authorization = 'Bearer token';
    await invokeRoute('GET', '/me', req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      team: { id: 1, name: 'Acme', role: 'admin' },
    });
  });

  it('GET /me returns 404 when caller has no team', async () => {
    mockService.getMyTeam.mockResolvedValue(undefined);
    const { req, res } = mockReqRes('GET', '/me');
    req.headers.authorization = 'Bearer token';
    await invokeRoute('GET', '/me', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('GET /:id/members returns members and pending invites', async () => {
    mockService.listTeamMembers.mockResolvedValue({
      members: [{ accountId: 1, accountEmail: 'a@x.com', role: 'admin', monthlyLimitCredits: 100 }],
      invites: [{ id: 9, email: 'b@x.com', role: 'member', monthlyLimitCredits: null }],
    });
    const { req, res } = mockReqRes('GET', '/1/members');
    req.headers.authorization = 'Bearer token';
    await invokeRoute('GET', '/1/members', req, res);

    expect(res.json).toHaveBeenCalledWith({
      teamId: 1,
      members: [{ accountId: 1, accountEmail: 'a@x.com', role: 'admin', monthlyLimitCredits: 100 }],
      invites: [{ id: 9, email: 'b@x.com', role: 'member', monthlyLimitCredits: null }],
    });
  });

  it('GET /:id/members returns 403 for non-members', async () => {
    mockService.hasRole.mockResolvedValue(false);
    const { req, res } = mockReqRes('GET', '/1/members');
    req.headers.authorization = 'Bearer token';
    await invokeRoute('GET', '/1/members', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST /:id/members/:userId/limit sets a monthly limit', async () => {
    mockService.setMemberMonthlyLimit.mockResolvedValue({
      teamId: 1,
      accountId: 5,
      monthlyLimitCredits: 250,
    });
    const { req, res } = mockReqRes('POST', '/1/members/5/limit', {
      body: { monthlyLimitCredits: 250 },
    });
    req.headers.authorization = 'Bearer token';
    await invokeRoute('POST', '/1/members/5/limit', req, res);

    expect(mockService.setMemberMonthlyLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 1,
        targetAccountId: 5,
        monthlyLimitCredits: 250,
        changedByAccountId: expect.any(Number),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, monthlyLimitCredits: 250 }));
  });

  it('POST /:id/members/:userId/limit rejects negative values', async () => {
    const { req, res } = mockReqRes('POST', '/1/members/5/limit', {
      body: { monthlyLimitCredits: -5 },
    });
    req.headers.authorization = 'Bearer token';
    await invokeRoute('POST', '/1/members/5/limit', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockService.setMemberMonthlyLimit).not.toHaveBeenCalled();
  });

  it('POST /:id/invite with email creates a pending invite', async () => {
    mockService.inviteByEmail.mockResolvedValue({ id: 42, email: 'new@x.com' });
    const { req, res } = mockReqRes('POST', '/1/invite', {
      body: { email: 'new@x.com' },
    });
    req.headers.authorization = 'Bearer token';
    await invokeRoute('POST', '/1/invite', req, res);

    expect(mockService.inviteByEmail).toHaveBeenCalledWith(expect.objectContaining({ teamId: 1, email: 'new@x.com' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST /:id/invite rejects an invalid email', async () => {
    const { req, res } = mockReqRes('POST', '/1/invite', {
      body: { email: 'not-an-email' },
    });
    req.headers.authorization = 'Bearer token';
    await invokeRoute('POST', '/1/invite', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockService.inviteByEmail).not.toHaveBeenCalled();
  });

  it('DELETE /:id/invites/:inviteId revokes a pending invite', async () => {
    mockService.revokeInvite.mockResolvedValue(true);
    const { req, res } = mockReqRes('DELETE', '/1/invites/42');
    req.headers.authorization = 'Bearer token';
    await invokeRoute('DELETE', '/1/invites/42', req, res);

    expect(mockService.revokeInvite).toHaveBeenCalledWith(expect.objectContaining({ teamId: 1, inviteId: 42 }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('DELETE /:id/invites/:inviteId returns 404 when invite not pending', async () => {
    mockService.revokeInvite.mockResolvedValue(false);
    const { req, res } = mockReqRes('DELETE', '/1/invites/42');
    req.headers.authorization = 'Bearer token';
    await invokeRoute('DELETE', '/1/invites/42', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('requires account identification when no JWT or header is present', async () => {
    const { req, res } = mockReqRes('GET', '/1/members');
    await invokeRoute('GET', '/1/members', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Account identification required.' }));
  });
});
