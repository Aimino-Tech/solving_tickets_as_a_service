/**
 * Unit tests for src/billing/dispatchGate.ts — billing/quota enforcement
 * wired into the fix dispatch path (AIM-4647).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckUsageBeforeFix = vi.hoisted(() => vi.fn());
const mockIncrementBillingUsage = vi.hoisted(() => vi.fn());
const mockApplyBalanceAfterLimit = vi.hoisted(() => vi.fn());

vi.mock('../../billing/usage.js', () => ({
  checkUsageBeforeFix: mockCheckUsageBeforeFix,
  incrementBillingUsage: mockIncrementBillingUsage,
}));
vi.mock('../../billing/plans.js', () => ({}));
vi.mock('../../usage-limits/enforcement.js', () => ({
  applyBalanceAfterLimit: mockApplyBalanceAfterLimit,
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('billing/dispatchGate', () => {
  let gate: typeof import('../../billing/dispatchGate.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    gate = await import('../../billing/dispatchGate.js');
  });

  describe('checkDispatchAllowed', () => {
    it('allows when under quota', async () => {
      mockCheckUsageBeforeFix.mockResolvedValue({ allowed: true, usage: 3, limit: 10, remaining: 7 });
      const result = await gate.checkDispatchAllowed(42, 'pro');
      expect(result.allowed).toBe(true);
      expect(result.planId).toBe('solo');
      expect(result.consumedCredits).toBe(0);
      expect(mockApplyBalanceAfterLimit).not.toHaveBeenCalled();
    });

    it('blocks when over quota and no balance override', async () => {
      mockCheckUsageBeforeFix.mockResolvedValue({
        allowed: false, usage: 10, limit: 10, remaining: 0,
        error: 'Monthly fix limit of 10 reached.',
      });
      mockApplyBalanceAfterLimit.mockResolvedValue({ allowed: false, consumedCredits: 0, remainingBalance: 0 });
      const result = await gate.checkDispatchAllowed(42, 'free');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Monthly fix limit of 10 reached.');
      expect(mockApplyBalanceAfterLimit).toHaveBeenCalledWith(42);
    });

    it('allows and consumes credits when balance override enabled', async () => {
      mockCheckUsageBeforeFix.mockResolvedValue({
        allowed: false, usage: 10, limit: 10, remaining: 0,
        error: 'Monthly fix limit of 10 reached.',
      });
      mockApplyBalanceAfterLimit.mockResolvedValue({ allowed: true, consumedCredits: 50, remainingBalance: 300 });
      const result = await gate.checkDispatchAllowed(42, 'pro');
      expect(result.allowed).toBe(true);
      expect(result.consumedCredits).toBe(50);
      expect(result.remainingBalance).toBe(300);
      expect(result.reason).toContain('balance-after-limits');
    });

    it('fails open on gate errors', async () => {
      mockCheckUsageBeforeFix.mockRejectedValue(new Error('redis down'));
      const result = await gate.checkDispatchAllowed(42, 'enterprise');
      expect(result.allowed).toBe(true);
      expect(result.planId).toBe('enterprise');
    });

    it('defaults unknown tiers to free plan', async () => {
      mockCheckUsageBeforeFix.mockResolvedValue({ allowed: true, usage: 0, limit: 10, remaining: 10 });
      const result = await gate.checkDispatchAllowed(42, 'mystery-tier');
      expect(result.planId).toBe('free');
    });

    it('maps self-hosted tier to selfHosted plan', async () => {
      mockCheckUsageBeforeFix.mockResolvedValue({ allowed: true, usage: 0, limit: 999_999, remaining: 999_999 });
      const result = await gate.checkDispatchAllowed(42, 'self-hosted');
      expect(result.planId).toBe('selfHosted');
    });
  });

  describe('recordDispatchedFix', () => {
    it('increments billing usage for the account', async () => {
      mockIncrementBillingUsage.mockResolvedValue(undefined);
      await gate.recordDispatchedFix(42);
      expect(mockIncrementBillingUsage).toHaveBeenCalledWith(42);
    });
  });
});
