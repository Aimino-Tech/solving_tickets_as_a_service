/**
 * Unit tests for src/billing/stripe.ts — Stripe subscription management.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mutable config mock to avoid resetModules leakage
const mockConfig: any = {
  config: {
    stripe: {
      secretKey: 'sk_test_mock',
      soloPriceId: 'price_solo_mock',
      teamPriceId: 'price_team_mock',
    },
  },
};

const mockLogger: any = {
  rootLogger: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
};

// Build a mock Stripe client instance whose methods we can control.
function createMockStripeClient() {
  return {
    customers: { create: vi.fn(), retrieve: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    invoices: { list: vi.fn() },
    products: { create: vi.fn() },
    prices: { create: vi.fn() },
  };
}

let sharedMockClient: ReturnType<typeof createMockStripeClient>;
vi.mock('stripe', () => ({
  default: function() { return sharedMockClient; },
}));

vi.mock('../../config.js', () => mockConfig);
vi.mock('../../utils/logger.js', () => mockLogger);

describe('billing/stripe', () => {
  let stripe: typeof import('../../billing/stripe.js');
  let mockStripeClient: ReturnType<typeof createMockStripeClient>;

  beforeEach(async () => {
    // Create a fresh mock client for each test
    mockStripeClient = createMockStripeClient();
    sharedMockClient = mockStripeClient;

    // Reset modules so the stripe mock picks up our new client
    vi.resetModules();

    // Import the module under test
    const mod = await import('../../billing/stripe.js');
    stripe = mod;

    // Reset the cached Stripe client so getStripeClient() will re-create
    stripe.resetStripeClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BillingError', () => {
    it('creates an error with message, code, and statusCode', () => {
      const err = new stripe.BillingError('Test error', 'TEST_CODE', 400);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Test error');
      expect(err.code).toBe('TEST_CODE');
      expect(err.statusCode).toBe(400);
      expect(err.name).toBe('BillingError');
    });

    it('defaults to BILLING_ERROR and 500', () => {
      const err = new stripe.BillingError('Oops');
      expect(err.code).toBe('BILLING_ERROR');
      expect(err.statusCode).toBe(500);
    });
  });

  describe('getStripeClient', () => {
    it('throws BillingError when secret key is missing', async () => {
      mockConfig.config.stripe.secretKey = '';
      // Need a fresh import without our spy for this test
      vi.restoreAllMocks();
      vi.resetModules();
      const mod = await import('../../billing/stripe.js');
      expect(() => mod.getStripeClient()).toThrow('STRIPE_SECRET_KEY is not configured');
      mockConfig.config.stripe.secretKey = 'sk_test_mock';
    });

    it('creates and returns a Stripe client', () => {
      const client = stripe.getStripeClient();
      expect(client).toBeDefined();
    });

    it('returns the same client on subsequent calls (singleton)', () => {
      const client1 = stripe.getStripeClient();
      const client2 = stripe.getStripeClient();
      expect(client1).toBe(client2);
    });
  });

  describe('resetStripeClient', () => {
    it('clears the cached client', () => {
      const client1 = stripe.getStripeClient();
      stripe.resetStripeClient();
      sharedMockClient = createMockStripeClient();
      const client2 = stripe.getStripeClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe('findOrCreateCustomer', () => {
    it('creates a Stripe customer with account metadata', async () => {
      mockStripeClient.customers.create.mockResolvedValue({ id: 'cus_mock', email: 'test@test.com' });
      const customer = await stripe.findOrCreateCustomer(42, 'test@test.com', 'Test User');
      expect(mockStripeClient.customers.create).toHaveBeenCalledWith({
        email: 'test@test.com', name: 'Test User', metadata: { accountId: '42' },
      });
      expect(customer.id).toBe('cus_mock');
    });
  });

  describe('getCustomer', () => {
    it('retrieves a Stripe customer by ID', async () => {
      mockStripeClient.customers.retrieve.mockResolvedValue({ id: 'cus_mock' });
      const customer = await stripe.getCustomer('cus_mock');
      expect(mockStripeClient.customers.retrieve).toHaveBeenCalledWith('cus_mock');
      expect(customer.id).toBe('cus_mock');
    });
  });

  describe('createSubscriptionCheckoutSession', () => {
    it('creates a checkout session and returns url + sessionId', async () => {
      mockStripeClient.checkout.sessions.create.mockResolvedValue({
        id: 'cs_mock', url: 'https://checkout.stripe.com/pay/cs_mock',
      });
      const result = await stripe.createSubscriptionCheckoutSession({
        accountId: 42, planId: 'solo',
        successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel',
      });
      expect(result.url).toBe('https://checkout.stripe.com/pay/cs_mock');
      expect(result.sessionId).toBe('cs_mock');
    });

    it('throws BillingError for unknown plan', async () => {
      await expect(stripe.createSubscriptionCheckoutSession({
        accountId: 42, planId: 'unknown' as any,
        successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel',
      })).rejects.toThrow(stripe.BillingError);
    });

    it('throws BillingError when session has no url', async () => {
      mockStripeClient.checkout.sessions.create.mockResolvedValue({ id: 'cs_mock', url: null });
      await expect(stripe.createSubscriptionCheckoutSession({
        accountId: 42, planId: 'solo',
        successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel',
      })).rejects.toThrow('Stripe Checkout session creation returned no URL');
    });
  });

  describe('createBillingPortalSession', () => {
    it('creates a billing portal session', async () => {
      mockStripeClient.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_mock' });
      const result = await stripe.createBillingPortalSession('cus_mock', 'https://example.com/return');
      expect(result.url).toBe('https://billing.stripe.com/p/session_mock');
    });
  });

  describe('getSubscription', () => {
    it('retrieves a subscription by ID', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({ id: 'sub_mock' });
      const sub = await stripe.getSubscription('sub_mock');
      expect(sub.id).toBe('sub_mock');
    });
  });

  describe('cancelSubscriptionAtPeriodEnd', () => {
    it('updates subscription with cancel_at_period_end: true', async () => {
      mockStripeClient.subscriptions.update.mockResolvedValue({ id: 'sub_mock', cancel_at_period_end: true });
      const result = await stripe.cancelSubscriptionAtPeriodEnd('sub_mock');
      expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith('sub_mock', { cancel_at_period_end: true });
      expect(result.cancel_at_period_end).toBe(true);
    });
  });

  describe('reactivateSubscription', () => {
    it('updates subscription with cancel_at_period_end: false', async () => {
      mockStripeClient.subscriptions.update.mockResolvedValue({ id: 'sub_mock', cancel_at_period_end: false });
      const result = await stripe.reactivateSubscription('sub_mock');
      expect(result.cancel_at_period_end).toBe(false);
    });
  });

  describe('updateSubscriptionPlan', () => {
    it('updates subscription to a new price', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({ id: 'sub_mock', items: { data: [{ id: 'si_mock' }] } });
      mockStripeClient.subscriptions.update.mockResolvedValue({ id: 'sub_mock' });
      const result = await stripe.updateSubscriptionPlan('sub_mock', 'price_new');
      expect(result.id).toBe('sub_mock');
    });

    it('throws BillingError when subscription has no items', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({ id: 'sub_mock', items: { data: [] } });
      await expect(stripe.updateSubscriptionPlan('sub_mock', 'price_new')).rejects.toThrow(stripe.BillingError);
    });
  });

  describe('createStripeProductsAndPrices', () => {
    it('creates products and prices for billable plans', async () => {
      mockStripeClient.products.create.mockResolvedValue({ id: 'prod_mock' });
      mockStripeClient.prices.create.mockResolvedValue({ id: 'price_mock' });
      const results = await stripe.createStripeProductsAndPrices();
      expect(results.solo).toBeDefined();
      expect(results.team).toBeDefined();
    });
  });
});
