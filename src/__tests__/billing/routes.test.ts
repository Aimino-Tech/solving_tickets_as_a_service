/**
 * Unit tests for src/billing/routes.ts — Billing API routes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('express', () => ({ Router: vi.fn(() => ({ use: vi.fn().mockReturnThis(), get: vi.fn().mockReturnThis(), post: vi.fn().mockReturnThis() })) }));
vi.mock('express-rate-limit', () => ({ default: vi.fn(() => (req: any, res: any, next: any) => next()) }));
vi.mock('../../config.js', () => ({
  config: { stripe: { soloPriceId: 'price_solo', teamPriceId: 'price_team' } },
}));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: vi.fn() }));
vi.mock('../../billing/stripe.js', () => ({
  createSubscriptionCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  reactivateSubscription: vi.fn(),
  BillingError: class extends Error {},
}));
vi.mock('../../billing/trial.js', () => ({
  getTrialStatus: vi.fn(),
  startTrial: vi.fn(),
}));

describe('billing/routes', () => {
  it('exports billingRouter', async () => {
    const mod = await import('../../billing/routes.js');
    expect(mod.billingRouter).toBeDefined();
  });
});
