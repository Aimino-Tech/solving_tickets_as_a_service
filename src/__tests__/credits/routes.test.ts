/**
 * Unit tests for src/credits/routes.ts — Credit system REST API routes.
 *
 * Strategy: mock Express Router to capture handler closures, then invoke
 * each handler directly with mock req/res objects. The routeHandlers array
 * is populated once at module load (vi.mock is hoisted).
 */
import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';

// ── Env baseline (required by config.ts) ─────────────────────────────────
beforeAll(() => {
  vi.stubEnv('GITHUB_APP_ID', 'test-app-123');
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret-456');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
  vi.stubEnv('OPENCODE_API_KEY', 'test-opencode-api-key');
});

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
const mockGetBalance = vi.fn();
const mockGetTransactions = vi.fn();
const mockCredit = vi.fn();
const mockDeduct = vi.fn();
const mockCreateCheckoutSession = vi.fn();
const mockQuery = vi.fn();

vi.mock('../../db/repositories/CreditsRepository.js', () => ({
  creditsRepository: {
    getBalance: mockGetBalance,
    getTransactions: mockGetTransactions,
    credit: mockCredit,
    deduct: mockDeduct,
  },
}));

vi.mock('../../stripe/checkout.js', () => ({ createCheckoutSession: mockCreateCheckoutSession }));
vi.mock('../../stripe/credit-packs.js', () => ({
  CREDIT_PACKS: {
    small: { priceId: 'price_100credits', credits: 100, bonus: 0, label: '100 Credits', amount: 1000 },
    medium: { priceId: 'price_500credits', credits: 500, bonus: 50, label: '500 + 50 Bonus', amount: 4500 },
  },
  getCreditPacks: () => [
    { priceId: 'price_100credits', credits: 100, bonus: 0, label: '100 Credits', amount: 1000 },
    { priceId: 'price_500credits', credits: 500, bonus: 50, label: '500 + 50 Bonus', amount: 4500 },
  ],
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));

// ── Config mock: admin.apiKey starts undefined (fail closed) ─────────────
let mockAdminApiKey: string | undefined;

vi.mock('../../config.js', () => ({
  config: {
    get admin() {
      return { apiKey: mockAdminApiKey, rateLimitMax: 10 };
    },
  },
}));

// ── Test helpers ─────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    headers: {},
    body: {},
    query: {},
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

// ── Load module once ─────────────────────────────────────────────────────

let moduleLoaded = false;

async function ensureModuleLoaded() {
  if (!moduleLoaded) {
    await import('../../credits/routes.js');
    moduleLoaded = true;
  }
}

// ── Suite ────────────────────────────────────────────────────────────────

describe('credits/routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminApiKey = undefined;
  });

  it('registers all 6 endpoints', async () => {
    await ensureModuleLoaded();
    expect(routeHandlers).toHaveLength(6);
    const paths = routeHandlers.map((h) => `${h.method.toUpperCase()} ${h.path}`);
    expect(paths).toContain('GET /credits/balance');
    expect(paths).toContain('GET /credits/packs');
    expect(paths).toContain('GET /credits/transactions');
    expect(paths).toContain('POST /credits/top-up');
    expect(paths).toContain('GET /credits/usage');
    expect(paths).toContain('POST /admin/credits/adjust');
  });

  // -----------------------------------------------------------------------
  // GET /credits/packs
  // -----------------------------------------------------------------------

  describe('GET /credits/packs', () => {
    it('returns credit packs with price IDs', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/packs')!;

      const req = mockReq({});
      const res = mockRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith([
        { credits: 100, bonus: 0, priceCents: 1000, priceId: 'price_100credits' },
        { credits: 500, bonus: 50, priceCents: 4500, priceId: 'price_500credits' },
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /credits/balance — S1, S2
  // -----------------------------------------------------------------------

  describe('GET /credits/balance', () => {
    it('returns 200 with balance for authenticated account (S1)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/balance')!;
      mockGetBalance.mockResolvedValue({ accountId: 42, balance: 1500, lifetimeCredits: 5000 });

      const req = mockReq({ headers: { 'x-account-id': '42' } });
      const res = mockRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        accountId: 42,
        balance: 1500,
        lifetimeCredits: 5000,
      });
    });

    it('returns 401 when x-account-id header is missing (S2)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/balance')!;

      const req = mockReq({ headers: {} });
      const res = mockRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unauthorized' }),
      );
    });

    it('returns 500 on DB error', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/balance')!;
      mockGetBalance.mockRejectedValue(new Error('DB connection failed'));

      const req = mockReq({ headers: { 'x-account-id': '42' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  // -----------------------------------------------------------------------
  // GET /credits/transactions — S3, S4
  // -----------------------------------------------------------------------

  describe('GET /credits/transactions', () => {
    it('returns 200 with paginated transactions (S3)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/transactions')!;
      const txns = [{ id: 1, accountId: 42, amount: 100, type: 'purchase', createdAt: new Date() }];
      mockGetTransactions.mockResolvedValue(txns);
      mockQuery.mockResolvedValue({ rows: [{ total: 1 }] });

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: { limit: '10', offset: '0' } });
      const res = mockRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        transactions: txns,
        pagination: { limit: 10, offset: 0, total: 1 },
      });
    });

    it('returns 400 for invalid query params (S4)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/transactions')!;

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: { limit: '999' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid query parameters' }),
      );
    });

    it('returns 401 when not authenticated', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/transactions')!;

      const req = mockReq({ headers: {} });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(401);
    });

    it('returns 500 on DB error', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/transactions')!;
      mockGetTransactions.mockRejectedValue(new Error('DB down'));

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: { limit: '10' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(500);
    });

    it('defaults pagination when no query params provided', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/transactions')!;
      mockGetTransactions.mockResolvedValue([]);
      mockQuery.mockResolvedValue({ rows: [{ total: 0 }] });

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: {} });
      const res = mockRes();
      await handler(req, res);

      expect(mockGetTransactions).toHaveBeenCalledWith(42, 50, 0);
    });
  });

  // -----------------------------------------------------------------------
  // POST /credits/top-up — S5, S6
  // -----------------------------------------------------------------------

  describe('POST /credits/top-up', () => {
    it('returns 200 with checkout URL for valid request (S5)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/credits/top-up')!;
      mockCreateCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
      });

      const req = mockReq({
        headers: { 'x-account-id': '42' },
        body: { priceId: 'price_500credits', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        url: 'https://checkout.stripe.com/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
      });
    });

    it('returns 404 for unknown price ID (S6)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/credits/top-up')!;
      mockCreateCheckoutSession.mockRejectedValue(new Error('Unknown price ID "price_invalid"'));

      const req = mockReq({
        headers: { 'x-account-id': '42' },
        body: { priceId: 'price_invalid', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unknown price ID' }),
      );
    });

    it('returns 400 for invalid request body', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/credits/top-up')!;

      const req = mockReq({
        headers: { 'x-account-id': '42' },
        body: { priceId: '' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid request body' }),
      );
    });

    it('returns 401 when not authenticated', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/credits/top-up')!;

      const req = mockReq({ headers: {}, body: { priceId: 'price_500credits', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(401);
    });

    it('returns 500 on Stripe error', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/credits/top-up')!;
      mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe API error'));

      const req = mockReq({
        headers: { 'x-account-id': '42' },
        body: { priceId: 'price_500credits', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  // GET /credits/usage — S7
  // -----------------------------------------------------------------------

  describe('GET /credits/usage', () => {
    it('returns 200 with monthly usage by default (S7)', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/usage')!;
      const usageRows = [
        { period_start: new Date('2025-01-01'), total_credits: 150, total_transactions: 3 },
        { period_start: new Date('2024-12-01'), total_credits: 50, total_transactions: 1 },
      ];
      mockQuery.mockResolvedValue({ rows: usageRows });

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: {} });
      const res = mockRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        accountId: 42,
        period: 'monthly',
        usage: [
          { periodStart: usageRows[0].period_start, totalCredits: 150, totalTransactions: 3 },
          { periodStart: usageRows[1].period_start, totalCredits: 50, totalTransactions: 1 },
        ],
      });
    });

    it('returns 400 for invalid period', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/usage')!;

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: { period: 'yearly' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(400);
    });

    it('returns 401 when not authenticated', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/usage')!;

      const req = mockReq({ headers: {}, query: {} });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(401);
    });

    it('returns 500 on DB error', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/usage')!;
      mockQuery.mockRejectedValue(new Error('DB down'));

      const req = mockReq({ headers: { 'x-account-id': '42' }, query: {} });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(500);
    });

    it('accepts weekly and daily periods', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('get', '/credits/usage')!;
      mockQuery.mockResolvedValue({ rows: [] });

      const weeklyReq = mockReq({ headers: { 'x-account-id': '42' }, query: { period: 'weekly' } });
      const weeklyRes = mockRes();
      await handler(weeklyReq, weeklyRes);
      expect(weeklyRes._state.statusCode).toBeUndefined();

      const dailyReq = mockReq({ headers: { 'x-account-id': '42' }, query: { period: 'daily' } });
      const dailyRes = mockRes();
      await handler(dailyReq, dailyRes);
      expect(dailyRes._state.statusCode).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // POST /admin/credits/adjust — S8, S9
  // -----------------------------------------------------------------------

  describe('POST /admin/credits/adjust', () => {
    it('returns 501 when admin API key is not configured', async () => {
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;

      const req = mockReq({ headers: {}, body: { accountId: 42, amount: 500 } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(501);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Not Implemented' }),
      );
    });

    it('returns 401 with invalid admin key', async () => {
      mockAdminApiKey = 'secret-admin-key';
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;

      const req = mockReq({ headers: { 'x-admin-key': 'wrong-key' }, body: { accountId: 42, amount: 500 } });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(401);
    });

    it('credits account with positive amount (S8)', async () => {
      mockAdminApiKey = 'secret-admin-key';
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;
      mockCredit.mockResolvedValue({ accountId: 42, balance: 2000, lifetimeCredits: 2000 });

      const req = mockReq({
        headers: { 'x-admin-key': 'secret-admin-key' },
        body: { accountId: 42, amount: 500, description: 'Bonus', type: 'adjustment' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(mockCredit).toHaveBeenCalledWith(42, 500, expect.objectContaining({ type: 'adjustment' }));
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 42, newBalance: 2000, amount: 500 }),
      );
    });

    it('deducts account with negative amount', async () => {
      mockAdminApiKey = 'secret-admin-key';
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;
      mockDeduct.mockResolvedValue({ accountId: 42, balance: 500, lifetimeCredits: 2000 });

      const req = mockReq({
        headers: { 'x-admin-key': 'secret-admin-key' },
        body: { accountId: 42, amount: -300, description: 'Penalty', type: 'adjustment' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(mockDeduct).toHaveBeenCalledWith(42, 300, expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 42, newBalance: 500, amount: -300 }),
      );
    });

    it('returns 402 for debit with insufficient credits (S9)', async () => {
      mockAdminApiKey = 'secret-admin-key';
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;
      mockDeduct.mockRejectedValue(new Error('Insufficient credits: 10 available, 1000 required'));

      const req = mockReq({
        headers: { 'x-admin-key': 'secret-admin-key' },
        body: { accountId: 42, amount: -1000, description: 'Big debit' },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Insufficient credits' }),
      );
    });

    it('returns 400 for invalid body', async () => {
      mockAdminApiKey = 'secret-admin-key';
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;

      const req = mockReq({
        headers: { 'x-admin-key': 'secret-admin-key' },
        body: { accountId: 'not-a-number', amount: 0 },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(400);
    });

    it('returns 500 on repository error', async () => {
      mockAdminApiKey = 'secret-admin-key';
      await ensureModuleLoaded();
      const handler = findHandler('post', '/admin/credits/adjust')!;
      mockCredit.mockRejectedValue(new Error('DB error'));

      const req = mockReq({
        headers: { 'x-admin-key': 'secret-admin-key' },
        body: { accountId: 42, amount: 500 },
      });
      const res = mockRes();
      await handler(req, res);

      expect(res._state.statusCode).toBe(500);
    });
  });
});
