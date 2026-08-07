/**
 * Unit tests for src/referral/routes.ts — Referral program REST API routes.
 *
 * Strategy: mock Express Router to capture handler closures, then invoke
 * each handler directly with mock req/res objects (same approach as
 * src/__tests__/credits/routes.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Captured route handlers (populated once at module load) ──────────────
const routeHandlers: Array<{ method: string; path: string; handler: Function }> = [];

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    use: vi.fn(),
    get: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'get', path, handler: middleware[middleware.length - 1] });
    }),
    post: vi.fn((path: string, ...middleware: Function[]) => {
      routeHandlers.push({ method: 'post', path, handler: middleware[middleware.length - 1] });
    }),
  })),
}));

// ── Mock dependencies ────────────────────────────────────────────────────
const mockRedeem = vi.fn();
const mockRegisterClick = vi.fn();
const mockGetStats = vi.fn();
const mockGetOrCreateCode = vi.fn();
const mockListRewards = vi.fn();
const mockClaimReward = vi.fn();
const mockQuery = vi.fn();

class MockReferralError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'ReferralError';
  }
}

vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../auth/middleware.js', () => ({ requireAuth: vi.fn() }));

vi.mock('../../referral/service.js', () => ({
  ReferralError: MockReferralError,
  referralService: {
    redeem: mockRedeem,
    registerClick: mockRegisterClick,
    getStats: mockGetStats,
    getOrCreateCode: mockGetOrCreateCode,
    listRewards: mockListRewards,
    claimReward: mockClaimReward,
  },
}));

// ── Test helpers ─────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    headers: {},
    body: {},
    query: {},
    params: {},
    path: '/test',
    ...overrides,
  };
}

function mockRes(): any {
  const state: { statusCode?: number; body?: any } = {};
  const res = {
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return res;
    }),
    json: vi.fn((data: any) => {
      state.body = data;
      return res;
    }),
    _state: state,
  };
  return res;
}

function findHandler(method: string, path: string): Function | undefined {
  const entry = routeHandlers.find((h) => h.method === method && h.path === path);
  return entry?.handler;
}

let moduleLoaded = false;

async function ensureModuleLoaded() {
  if (!moduleLoaded) {
    await import('../../referral/routes.js');
    moduleLoaded = true;
  }
}

const EMPTY_STATS = { totalClicks: 0, totalInvited: 0, totalEarnedFixes: 0, pendingFixes: 0 };

// ── Suite ────────────────────────────────────────────────────────────────

describe('referral/routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all 7 endpoints', async () => {
    await ensureModuleLoaded();
    expect(routeHandlers).toHaveLength(7);
    const paths = routeHandlers.map((h) => `${h.method.toUpperCase()} ${h.path}`);
    expect(paths).toContain('GET /referral/code');
    expect(paths).toContain('POST /referral/code');
    expect(paths).toContain('POST /referral/redeem');
    expect(paths).toContain('POST /referral/click');
    expect(paths).toContain('GET /referral/stats');
    expect(paths).toContain('GET /referral/rewards');
    expect(paths).toContain('POST /referral/rewards/:id/claim');
  });

  // -----------------------------------------------------------------------
  // POST /referral/redeem — (a) invalid code, (b) self-referral, (c) idempotent
  // -----------------------------------------------------------------------

  describe('POST /referral/redeem', () => {
    it('rejects an invalid referral code with 400', async () => {
      await ensureModuleLoaded();
      mockRedeem.mockRejectedValue(new MockReferralError('Invalid referral code', 400));

      const req = mockReq({ body: { code: 'ZZZZZZZZ', email: 'new@example.com' } });
      const res = mockRes();
      await findHandler('post', '/referral/redeem')!(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid referral code' });
    });

    it('rejects self-referral with 400', async () => {
      await ensureModuleLoaded();
      mockRedeem.mockRejectedValue(new MockReferralError('You cannot redeem your own referral code', 400));

      const req = mockReq({ body: { code: 'ABCDEFGH', email: 'me@example.com' } });
      const res = mockRes();
      await findHandler('post', '/referral/redeem')!(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'You cannot redeem your own referral code' });
    });

    it('rejects a disposable email domain with 400', async () => {
      await ensureModuleLoaded();
      mockRedeem.mockRejectedValue(new MockReferralError('Disposable email addresses are not allowed', 400));

      const req = mockReq({ body: { code: 'ABCDEFGH', email: 'x@mailinator.com' } });
      const res = mockRes();
      await findHandler('post', '/referral/redeem')!(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Disposable email addresses are not allowed' });
    });

    it('is idempotent per email — repeated calls return ok without duplicates', async () => {
      await ensureModuleLoaded();
      mockRedeem.mockResolvedValue(undefined);

      const req = () => mockReq({ body: { code: 'ABCDEFGH', email: 'invitee@example.com' } });
      const first = mockRes();
      const second = mockRes();
      const handler = findHandler('post', '/referral/redeem')!;

      await handler(req(), first);
      await handler(req(), second);

      expect(mockRedeem).toHaveBeenCalledTimes(2);
      expect(mockRedeem).toHaveBeenCalledWith('ABCDEFGH', 'invitee@example.com');
      expect(first._state.statusCode).toBe(201);
      expect(first.json).toHaveBeenCalledWith({ ok: true });
      expect(second._state.statusCode).toBe(201);
      expect(second.json).toHaveBeenCalledWith({ ok: true });
    });

    it('rejects malformed body with 400', async () => {
      await ensureModuleLoaded();
      const req = mockReq({ body: { code: 'ABCDEFGH', email: 'not-an-email' } });
      const res = mockRes();
      await findHandler('post', '/referral/redeem')!(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(mockRedeem).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // POST /referral/click — click tracking
  // -----------------------------------------------------------------------

  describe('POST /referral/click', () => {
    it('returns ok for a known code', async () => {
      await ensureModuleLoaded();
      mockRegisterClick.mockResolvedValue(true);

      const req = mockReq({ body: { code: 'ABCDEFGH' } });
      const res = mockRes();
      await findHandler('post', '/referral/click')!(req, res);

      expect(mockRegisterClick).toHaveBeenCalledWith('ABCDEFGH');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 400 Invalid referral code for an unknown code', async () => {
      await ensureModuleLoaded();
      mockRegisterClick.mockResolvedValue(false);

      const req = mockReq({ body: { code: 'ZZZZZZZZ' } });
      const res = mockRes();
      await findHandler('post', '/referral/click')!(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid referral code' });
    });

    it('rejects a missing code with 400', async () => {
      await ensureModuleLoaded();
      const req = mockReq({ body: {} });
      const res = mockRes();
      await findHandler('post', '/referral/click')!(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(mockRegisterClick).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // GET /referral/stats — (f) stats shape, auth required
  // -----------------------------------------------------------------------

  describe('GET /referral/stats', () => {
    it('returns all 4 numeric fields for an authenticated account', async () => {
      await ensureModuleLoaded();
      mockGetStats.mockResolvedValue({
        totalClicks: 12,
        totalInvited: 3,
        totalEarnedFixes: 20,
        pendingFixes: 10,
      });

      const req = mockReq({ headers: { 'x-account-id': '42' } });
      const res = mockRes();
      await findHandler('get', '/referral/stats')!(req, res);

      expect(mockGetStats).toHaveBeenCalledWith(42);
      expect(res.json).toHaveBeenCalledWith({
        stats: { totalClicks: 12, totalInvited: 3, totalEarnedFixes: 20, pendingFixes: 10 },
      });
    });

    it('returns 0 for every field when the account has no data', async () => {
      await ensureModuleLoaded();
      mockGetStats.mockResolvedValue(EMPTY_STATS);

      const req = mockReq({ headers: { 'x-account-id': '42' } });
      const res = mockRes();
      await findHandler('get', '/referral/stats')!(req, res);

      const body = res.json.mock.calls[0][0] as { stats: Record<string, unknown> };
      for (const key of Object.keys(EMPTY_STATS)) {
        expect(body.stats[key]).toBe(0);
        expect(typeof body.stats[key]).toBe('number');
      }
    });

    it('returns 401 without auth', async () => {
      await ensureModuleLoaded();
      const req = mockReq({ headers: {} });
      const res = mockRes();
      await findHandler('get', '/referral/stats')!(req, res);

      expect(res._state.statusCode).toBe(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });

  // -----------------------------------------------------------------------
  // POST /referral/rewards/:id/claim — (d) double-claim protection
  // -----------------------------------------------------------------------

  describe('POST /referral/rewards/:id/claim', () => {
    it('grants fixes once and rejects the second claim with 400', async () => {
      await ensureModuleLoaded();
      const reward = {
        id: 7,
        accountId: 42,
        referredEmail: 'invitee@example.com',
        amountCredits: 0,
        amountFixes: 10,
        status: 'claimed',
        createdAt: new Date(),
        claimedAt: new Date(),
      };
      mockClaimReward
        .mockResolvedValueOnce({ claimed: true, reward, newAllowance: 10 })
        .mockRejectedValueOnce(new MockReferralError('Reward already claimed', 400));

      const handler = findHandler('post', '/referral/rewards/:id/claim')!;
      const req = mockReq({ headers: { 'x-account-id': '42' }, params: { id: '7' } });

      const first = mockRes();
      await handler(req, first);
      expect(first.json).toHaveBeenCalledWith({ claimed: true, reward, newAllowance: 10 });

      const second = mockRes();
      await handler(req, second);
      expect(second._state.statusCode).toBe(400);
      expect(second.json).toHaveBeenCalledWith({ error: 'Reward already claimed' });
    });
  });
});
