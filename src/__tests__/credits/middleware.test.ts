/**
 * Unit tests for src/credits/middleware.ts — Deduct middleware.
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

    it('deducts credits and calls next when sufficient', async () => {
      mockGetBalance.mockResolvedValue({ balance: 100 });
      mockDeduct.mockResolvedValue({ balance: 50 });
      const mw = middleware.deductMiddleware({ amount: 50 });
      const req = { headers: { 'x-account-id': '42' }, body: {}, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      await mw(req, res, next);
      expect(mockDeduct).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      expect((req as any).creditDeduction).toBeDefined();
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
  });
});
