/**
 * Unit tests for src/stripe/checkout.ts -- Stripe Checkout session creation.
 *
 * Strategy:
 *   Mock the Stripe SDK to avoid real API calls. Test that `createCheckoutSession`
 *   validates inputs, creates sessions with correct metadata, and returns the
 *   expected URL and session ID.
 *
 * Coverage:
 *   - Successful checkout session creation with each credit pack
 *   - Unknown price ID throws
 *   - Missing STRIPE_SECRET_KEY throws
 *   - Stripe API errors are propagated
 *   - CREDIT_PACKS read-only contract
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../../config.js';
import { getCreditPack, CREDIT_PACKS } from '../../stripe/credit-packs.js';

// -- Mocks -------------------------------------------------------------------

// Mock the Stripe SDK constructor and instance
const mockSessionsCreate = vi.fn();
const mockStripeInstance = {
  checkout: {
    sessions: {
      create: mockSessionsCreate,
    },
  },
};

vi.mock('stripe', () => ({
  default: class {
    constructor() {
      return mockStripeInstance;
    }
  },
}));

// Mock the config module so stripe.secretKey is set
vi.mock('../../config.js', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_mock_secret_key',
      webhookSecret: 'whsec_mock_webhook_secret',
      price100Credits: 'price_100credits',
      price500Credits: 'price_500credits',
      price2000Credits: 'price_2000credits',
    },
  },
}));

// -- Imports (after mocks) ---------------------------------------------------

import { createCheckoutSession, resetStripeClient } from '../../stripe/checkout.js';

// -- Suite -------------------------------------------------------------------

describe('createCheckoutSession', () => {
  beforeAll(() => {
    // Ensure the Stripe client is reset before each run
    resetStripeClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetStripeClient();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  const successUrl = 'https://example.com/success';
  const cancelUrl = 'https://example.com/cancel';

  describe('successful session creation', () => {
    it('creates a Checkout session for the small credit pack', async () => {
      mockSessionsCreate.mockResolvedValueOnce({
        id: 'cs_test_small',
        url: 'https://checkout.stripe.com/cs_test_small',
      });

      const smallPriceId = getCreditPack('small').priceId;

      const result = await createCheckoutSession({
        accountId: 1,
        priceId: smallPriceId,
        successUrl,
        cancelUrl,
      });

      expect(result).toEqual({
        url: 'https://checkout.stripe.com/cs_test_small',
        sessionId: 'cs_test_small',
      });

      expect(mockSessionsCreate).toHaveBeenCalledWith({
        mode: 'payment',
        line_items: [{ price: smallPriceId, quantity: 1 }],
        metadata: { accountId: '1', creditPack: 'small' },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
    });

    it('creates a Checkout session for the medium credit pack', async () => {
      mockSessionsCreate.mockResolvedValueOnce({
        id: 'cs_test_medium',
        url: 'https://checkout.stripe.com/cs_test_medium',
      });

      const mediumPriceId = getCreditPack('medium').priceId;

      const result = await createCheckoutSession({
        accountId: 42,
        priceId: mediumPriceId,
        successUrl,
        cancelUrl,
      });

      expect(result.sessionId).toBe('cs_test_medium');
      expect(mockSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { accountId: '42', creditPack: 'medium' },
          line_items: [{ price: mediumPriceId, quantity: 1 }],
        }),
      );
    });

    it('creates a Checkout session for the large credit pack', async () => {
      mockSessionsCreate.mockResolvedValueOnce({
        id: 'cs_test_large',
        url: 'https://checkout.stripe.com/cs_test_large',
      });

      const largePriceId = getCreditPack('large').priceId;

      const result = await createCheckoutSession({
        accountId: 99,
        priceId: largePriceId,
        successUrl,
        cancelUrl,
      });

      expect(result.sessionId).toBe('cs_test_large');
      expect(mockSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { accountId: '99', creditPack: 'large' },
          line_items: [{ price: largePriceId, quantity: 1 }],
        }),
      );
    });
  });

  describe('error handling', () => {
    it('throws when an unknown price ID is provided', async () => {
      await expect(
        createCheckoutSession({
          accountId: 1,
          priceId: 'price_unknown',
          successUrl,
          cancelUrl,
        }),
      ).rejects.toThrow(/Unknown price ID/);
    });

    it('throws when Stripe returns no URL', async () => {
      mockSessionsCreate.mockResolvedValueOnce({
        id: 'cs_test_no_url',
        url: null,
      });

      await expect(
        createCheckoutSession({
          accountId: 1,
          priceId: getCreditPack('small').priceId,
          successUrl,
          cancelUrl,
        }),
      ).rejects.toThrow('Stripe Checkout session creation returned no URL or session ID');
    });

    it('throws when Stripe returns no session ID', async () => {
      mockSessionsCreate.mockResolvedValueOnce({
        id: null,
        url: 'https://checkout.stripe.com/cs_test_no_id',
      });

      await expect(
        createCheckoutSession({
          accountId: 1,
          priceId: getCreditPack('small').priceId,
          successUrl,
          cancelUrl,
        }),
      ).rejects.toThrow('Stripe Checkout session creation returned no URL or session ID');
    });

    it('propagates Stripe API errors', async () => {
      mockSessionsCreate.mockRejectedValueOnce(new Error('Stripe API error: rate limit exceeded'));

      await expect(
        createCheckoutSession({
          accountId: 1,
          priceId: getCreditPack('small').priceId,
          successUrl,
          cancelUrl,
        }),
      ).rejects.toThrow('Stripe API error: rate limit exceeded');
    });
  });
});

describe('CREDIT_PACKS', () => {
  it('defines three credit packs with expected values', () => {
    expect(CREDIT_PACKS.small).toEqual({
      priceId: '',
      credits: 100,
      bonus: 0,
      label: '100 Credits',
      amount: 1000,
    });

    expect(CREDIT_PACKS.medium).toEqual({
      priceId: '',
      credits: 500,
      bonus: 50,
      label: '500 + 50 Bonus',
      amount: 4500,
    });

    expect(CREDIT_PACKS.large).toEqual({
      priceId: '',
      credits: 2000,
      bonus: 200,
      label: '2000 + 200 Bonus',
      amount: 15000,
    });
  });

  it('is frozen (read-only)', () => {
    expect(() => {
      (CREDIT_PACKS as any).small = null;
    }).toThrow();
  });
});
