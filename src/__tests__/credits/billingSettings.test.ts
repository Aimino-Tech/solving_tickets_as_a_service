/**
 * Unit tests for src/credits/billingSettings.ts — auto-reload, monthly limit, cent rate.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockCreateCheckoutSession = vi.fn();
const mockGetCreditPacks = vi.fn();

vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));
vi.mock('../../stripe/checkout.js', () => ({ createCheckoutSession: mockCreateCheckoutSession }));
vi.mock('../../stripe/credit-packs.js', () => ({ getCreditPacks: mockGetCreditPacks }));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const DEFAULT_SETTINGS = {
  autoReloadEnabled: false,
  autoReloadThresholdCents: null,
  autoReloadTopupCents: null,
  monthlyLimitCents: null,
};

describe('credits/billingSettings', () => {
  let billingSettings: typeof import('../../credits/billingSettings.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetCreditPacks.mockReturnValue([
      { priceId: 'price_100credits', credits: 100, bonus: 0, label: '100 Credits', amount: 1000 },
      { priceId: 'price_500credits', credits: 500, bonus: 50, label: '500 + 50 Bonus', amount: 4500 },
      { priceId: 'price_2000credits', credits: 2000, bonus: 200, label: '2000 + 200 Bonus', amount: 15000 },
    ]);
    billingSettings = await import('../../credits/billingSettings.js');
    billingSettings.clearAutoReloadCooldown(42);
  });

  describe('getCentsPerCredit', () => {
    it('derives the rate from the smallest credit pack (10 cents/credit)', () => {
      expect(billingSettings.getCentsPerCredit()).toBe(10);
    });

    it('falls back to 10 when packs are unavailable', () => {
      mockGetCreditPacks.mockReturnValue([]);
      expect(billingSettings.getCentsPerCredit()).toBe(10);
    });
  });

  describe('getMonthSpendCents', () => {
    it('converts credits spent this month to cents', async () => {
      mockQuery.mockResolvedValue({ rows: [{ spent: 120 }] });
      await expect(billingSettings.getMonthSpendCents(42)).resolves.toBe(1200);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("DATE_TRUNC('month', NOW())"),
        [42],
      );
    });

    it('returns 0 when no spend recorded', async () => {
      mockQuery.mockResolvedValue({ rows: [{ spent: null }] });
      await expect(billingSettings.getMonthSpendCents(42)).resolves.toBe(0);
    });
  });

  describe('isMonthlyLimitExceeded', () => {
    it('blocks when spend has reached the limit', () => {
      expect(
        billingSettings.isMonthlyLimitExceeded({ ...DEFAULT_SETTINGS, monthlyLimitCents: 5000 }, 5000),
      ).toBe(true);
      expect(
        billingSettings.isMonthlyLimitExceeded({ ...DEFAULT_SETTINGS, monthlyLimitCents: 5000 }, 6000),
      ).toBe(true);
    });

    it('allows when spend is below the limit', () => {
      expect(
        billingSettings.isMonthlyLimitExceeded({ ...DEFAULT_SETTINGS, monthlyLimitCents: 5000 }, 4999),
      ).toBe(false);
    });

    it('allows when no limit is configured', () => {
      expect(billingSettings.isMonthlyLimitExceeded(DEFAULT_SETTINGS, 99999)).toBe(false);
    });
  });

  describe('triggerAutoReload', () => {
    it('returns null when auto-reload is disabled', async () => {
      await expect(billingSettings.triggerAutoReload(42, DEFAULT_SETTINGS, 50)).resolves.toBeNull();
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    });

    it('returns null when threshold or top-up is not configured', async () => {
      const settings = { ...DEFAULT_SETTINGS, autoReloadEnabled: true, autoReloadThresholdCents: 500 };
      await expect(billingSettings.triggerAutoReload(42, settings, 50)).resolves.toBeNull();
    });

    it('returns null when balance is above the threshold', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        autoReloadEnabled: true,
        autoReloadThresholdCents: 500,
        autoReloadTopupCents: 1000,
      };
      await expect(billingSettings.triggerAutoReload(42, settings, 100)).resolves.toBeNull();
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    });

    it('creates a checkout session and returns the checkout URL when below threshold', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        autoReloadEnabled: true,
        autoReloadThresholdCents: 500,
        autoReloadTopupCents: 1000,
      };
      mockCreateCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/cs_test_auto',
        sessionId: 'cs_test_auto',
      });

      const result = await billingSettings.triggerAutoReload(42, settings, 20);
      expect(result).toEqual({
        topUpRequired: true,
        checkoutUrl: 'https://checkout.stripe.com/cs_test_auto',
        topupCents: 1000,
      });
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 42, priceId: 'price_100credits' }),
      );
    });

    it('does not create a second checkout within the cooldown window', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        autoReloadEnabled: true,
        autoReloadThresholdCents: 500,
        autoReloadTopupCents: 1000,
      };
      mockCreateCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/cs_test_auto',
        sessionId: 'cs_test_auto',
      });

      await billingSettings.triggerAutoReload(42, settings, 20);
      const second = await billingSettings.triggerAutoReload(42, settings, 20);
      expect(second).toBeNull();
      expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    });

    it('allows a new checkout after the cooldown is cleared', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        autoReloadEnabled: true,
        autoReloadThresholdCents: 500,
        autoReloadTopupCents: 1000,
      };
      mockCreateCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/cs_test_auto',
        sessionId: 'cs_test_auto',
      });

      await billingSettings.triggerAutoReload(42, settings, 20);
      billingSettings.clearAutoReloadCooldown(42);
      const retry = await billingSettings.triggerAutoReload(42, settings, 20);
      expect(retry).not.toBeNull();
      expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(2);
    });

    it('returns null when checkout session creation fails', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        autoReloadEnabled: true,
        autoReloadThresholdCents: 500,
        autoReloadTopupCents: 1000,
      };
      mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe API error'));
      await expect(billingSettings.triggerAutoReload(42, settings, 20)).resolves.toBeNull();
    });
  });
});
