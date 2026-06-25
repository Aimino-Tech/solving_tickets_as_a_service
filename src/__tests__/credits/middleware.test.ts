/**
 * Unit tests for src/credits/middleware.ts — Deduct middleware and refund utility.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetBalance = vi.fn();
const mockDeduct = vi.fn();
const mockCredit = vi.fn();

vi.mock('../../db/repositories/CreditsRepository.js', () => ({
  creditsRepository: {
    getBalance: mockGetBalance,
    deduct: mockDeduct,
    credit: mockCredit,
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('credits/middleware', () => {
  let middleware: typeof import('../../credits/middleware.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    middleware = await import('../../credits/middleware.js');
  });

  describe('defaultGetAccountId', () => {
    it('extracts from x-account-id header', () => {
      const req = { headers: { 'x-account-id': '42' }, body: {} } as any;
      expect(middleware.defaultGetAccountId(req)).toBe(42);
    });

    it('extracts from body.accountId', () => {
      const req = { headers: {}, body: { accountId: 99 } } as any;
      expect(middleware.defaultGetAccountId(req)).toBe(99);
    });

    it('extracts from body.installation.id', () => {
      const req = { headers: {}, body: { installation: { id: 7 } } } as any;
      expect(middleware.defaultGetAccountId(req)).toBe(7);
    });

    it('returns null when nothing found', () => {
      const req = { headers: {}, body: {} } as any;
      expect(middleware.defaultGetAccountId(req)).toBeNull();
    });

    it('handles x-account-id as array (multiple header values)', () => {
      const req = { headers: { 'x-account-id': ['42', '99'] }, body: {} } as any;
      expect(middleware.defaultGetAccountId(req)).toBe(42);
    });

    it('ignores non-numeric x-account-id', () => {
      const req = { headers: { 'x-account-id': 'abc' }, body: {} } as any;
      expect(middleware.defaultGetAccountId(req)).toBeNull();
    });

    it('ignores non-positive x-account-id', () => {
      const req = { headers: { 'x-account-id': '0' }, body: {} } as any;
      expect(middleware.defaultGetAccountId(req)).toBeNull();
    });
  });

  describe('deductMiddleware', () => {
    it('allows request through when no account ID found', async () => {
      const mw = middleware.deductMiddleware();
      const req = { headers: {}, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows when accountId is 0 (falsy check)', async () => {
      const mw = middleware.deductMiddleware();
      const req = { headers: {}, body: { accountId: 0 }, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 402 when insufficient credits', async () => {
      mockGetBalance.mockResolvedValue({ balance: 10 });
      const mw = middleware.deductMiddleware({ amount: 50 });
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(402);
      expect(next).not.toHaveBeenCalled();
    });

    it('includes upgrade URL and credit details in 402 response', async () => {
      mockGetBalance.mockResolvedValue({ balance: 10 });
      const mw = middleware.deductMiddleware({ amount: 50 });
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient credits',
          balance: 10,
          required: 50,
          missing: 40,
          upgradeUrl: '/api/v1/credits/top-up',
        }),
      );
    });

    it('deducts credits and calls next when sufficient', async () => {
      mockGetBalance.mockResolvedValue({ balance: 100 });
      mockDeduct.mockResolvedValue({ balance: 50 });
      const mw = middleware.deductMiddleware({ amount: 50 });
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(mockDeduct).toHaveBeenCalledWith(42, 50, expect.objectContaining({ description: 'Fix run credit deduction' }));
      expect(next).toHaveBeenCalled();
      expect((req as any).creditDeduction).toBeDefined();
    });

    it('sets creditDeduction with correct metadata', async () => {
      mockGetBalance.mockResolvedValue({ balance: 100 });
      mockDeduct.mockResolvedValue({ balance: 50 });
      const mw = middleware.deductMiddleware({ amount: 50, description: 'Custom deduction' });
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect((req as any).creditDeduction).toEqual({
        accountId: 42,
        amount: 50,
        previousBalance: 100,
        newBalance: 50,
        description: 'Custom deduction',
      });
    });

    it('allows through on DB error (degraded behaviour)', async () => {
      mockGetBalance.mockRejectedValue(new Error('DB down'));
      const mw = middleware.deductMiddleware();
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('uses custom getAccountId when provided', async () => {
      mockGetBalance.mockResolvedValue({ balance: 100 });
      mockDeduct.mockResolvedValue({ balance: 50 });
      const customGetId = vi.fn(() => 99);
      const mw = middleware.deductMiddleware({ getAccountId: customGetId });
      const req = { headers: {}, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(customGetId).toHaveBeenCalledWith(req);
      expect(mockDeduct).toHaveBeenCalledWith(99, 50, expect.any(Object));
    });

    it('uses default amount of 50 when not specified', async () => {
      mockGetBalance.mockResolvedValue({ balance: 30 });
      const mw = middleware.deductMiddleware();
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(res.status).toHaveBeenCalledWith(402);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('refundCredits', () => {
    it('refunds credits for a failed run', async () => {
      mockCredit.mockResolvedValue({ balance: 150 });
      await middleware.refundCredits({ accountId: 42, amount: 50 });
      expect(mockCredit).toHaveBeenCalledWith(42, 50, expect.objectContaining({ type: 'refund' }));
    });

    it('skips refund when deduction is invalid', async () => {
      await middleware.refundCredits({} as any);
      expect(mockCredit).not.toHaveBeenCalled();
    });

    it('skips refund when accountId is missing', async () => {
      await middleware.refundCredits({ amount: 50 } as any);
      expect(mockCredit).not.toHaveBeenCalled();
    });

    it('skips refund when amount is zero or negative', async () => {
      await middleware.refundCredits({ accountId: 42, amount: 0 } as any);
      expect(mockCredit).not.toHaveBeenCalled();
    });

    it('appends "Refund:" prefix to the original description', async () => {
      mockCredit.mockResolvedValue({ balance: 150 });
      await middleware.refundCredits({ accountId: 42, amount: 50, description: 'Fix run credit deduction' });
      expect(mockCredit).toHaveBeenCalledWith(42, 50, expect.objectContaining({
        description: 'Refund: Fix run credit deduction',
      }));
    });

    it('does not crash when credit() throws', async () => {
      mockCredit.mockRejectedValue(new Error('DB error'));
      await expect(
        middleware.refundCredits({ accountId: 42, amount: 50 }),
      ).resolves.toBeUndefined();
    });

    it('uses default description when none provided', async () => {
      mockCredit.mockResolvedValue({ balance: 150 });
      await middleware.refundCredits({ accountId: 42, amount: 50 });
      expect(mockCredit).toHaveBeenCalledWith(42, 50, expect.objectContaining({
        description: 'Refund for failed fix run',
      }));
    });
  });
});
