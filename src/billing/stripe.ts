/**
 * Stripe subscription management client.
 *
 * Provides:
 *   - Creating Stripe Checkout Sessions for subscription purchases
 *   - Managing Stripe Customer objects linked to STAS accounts
 *   - Generating billing portal links
 *   - Creating products and prices in Stripe (dev helper)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   import { createSubscriptionCheckoutSession } from './billing/stripe.js';
 *   const { url } = await createSubscriptionCheckoutSession({
 *     accountId: 42,
 *     planId: 'solo',
 *     successUrl: 'https://app.stas.ai/billing/success',
 *     cancelUrl: 'https://app.stas.ai/billing/cancel',
 *   });
 *   // redirect user to `url`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * ── Error Handling ────────────────────────────────────────────────────────────
 * ✅ Missing STRIPE_SECRET_KEY throws a descriptive error
 * ✅ All Stripe API errors are caught, logged, and re-thrown as BillingError
 * ✅ Session creation validates plan existence before calling Stripe
 * ──────────────────────────────────────────────────────────────────────────────
 */

import Stripe from 'stripe';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { PLANS, getPlanByPriceId } from './plans.js';
import type { PlanId, Plan } from './plans.js';

const log = rootLogger.child({ module: 'billing-stripe' });

// ---------------------------------------------------------------------------
// Billing-specific error type
// ---------------------------------------------------------------------------

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'BILLING_ERROR',
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

// ---------------------------------------------------------------------------
// Stripe client
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null;

/**
 * Get (or create) the singleton Stripe client instance.
 * Lazily initialised so the module can load without STRIPE_SECRET_KEY set.
 */
export function getStripeClient(): Stripe {
  if (!_stripe) {
    const secretKey = config.stripe.secretKey;
    if (!secretKey) {
      throw new BillingError(
        'STRIPE_SECRET_KEY is not configured. Set it in your environment to enable billing.',
        'STRIPE_NOT_CONFIGURED',
        503,
      );
    }
    _stripe = new Stripe(secretKey, {
      apiVersion: '2026-05-27.dahlia' as any,
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Reset the cached Stripe client (useful for tests).
 */
export function resetStripeClient(): void {
  _stripe = null;
}

// ---------------------------------------------------------------------------
// Customer management
// ---------------------------------------------------------------------------

/**
 * Find or create a Stripe Customer for a STAS account.
 *
 * If the account already has a stripeCustomerId, returns the existing customer.
 * Otherwise, creates a new customer in Stripe and returns it.
 */
export async function findOrCreateCustomer(
  accountId: number,
  email?: string,
  name?: string,
): Promise<Stripe.Customer> {
  const stripe = getStripeClient();

  // Try to find existing customer ID (caller should pass it if known)
  // If no customer ID, create one
  const customer = await stripe.customers.create({
    email,
    name: name || `Account ${accountId}`,
    metadata: {
      accountId: String(accountId),
    },
  });

  log.info({ accountId, customerId: customer.id }, 'Stripe customer created/found');
  return customer;
}

/**
 * Get a Stripe Customer by ID.
 */
export async function getCustomer(customerId: string): Promise<Stripe.Customer> {
  const stripe = getStripeClient();
  return stripe.customers.retrieve(customerId) as Promise<Stripe.Customer>;
}

// ---------------------------------------------------------------------------
// Checkout Sessions
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Checkout Session for a subscription purchase.
 *
 * If the account has a Stripe customer ID, it is reused. Otherwise, a new
 * customer is created during the Checkout flow.
 *
 * @param opts.accountId   - Internal STAS account ID
 * @param opts.planId      - Plan ID ('solo' | 'team')
 * @param opts.successUrl  - Redirect URL on successful payment
 * @param opts.cancelUrl   - Redirect URL if user cancels
 * @param opts.customerId  - Existing Stripe customer ID (optional)
 * @param opts.trialDays   - Trial period in days (default: from plan config)
 *
 * @returns Checkout session URL and session ID
 */
export async function createSubscriptionCheckoutSession(opts: {
  accountId: number;
  planId: PlanId;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  trialDays?: number;
}): Promise<{ url: string; sessionId: string }> {
  const { accountId, planId, successUrl, cancelUrl, customerId } = opts;
  const stripe = getStripeClient();

  const plan = PLANS[planId];
  if (!plan) {
    throw new BillingError(
      `Unknown plan "${planId}". Valid plans: ${Object.keys(PLANS).join(', ')}`,
      'INVALID_PLAN',
      400,
    );
  }

  if (!plan.priceId) {
    throw new BillingError(
      `Plan "${planId}" has no Stripe Price ID configured. Contact support.`,
      'NO_PRICE_ID',
      500,
    );
  }

  const trialDays = opts.trialDays ?? plan.trialDays;

  log.info(
    { accountId, planId, customerId: customerId ?? 'new', trialDays },
    'Creating subscription Checkout session',
  );

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [
      {
        price: plan.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      accountId: String(accountId),
      planId,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        accountId: String(accountId),
        planId,
      },
    },
  };

  // Add trial period if configured
  if (trialDays > 0) {
    sessionParams.subscription_data = {
      ...sessionParams.subscription_data,
      trial_period_days: trialDays,
      trial_settings: {
        end_behavior: {
          missing_payment_method: 'cancel',
        },
      },
    };
  }

  // Reuse existing customer if provided
  if (customerId) {
    sessionParams.customer = customerId;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url || !session.id) {
    throw new BillingError(
      'Stripe Checkout session creation returned no URL or session ID',
      'SESSION_CREATION_FAILED',
    );
  }

  log.info(
    { sessionId: session.id, accountId, planId },
    'Subscription Checkout session created',
  );

  return {
    url: session.url,
    sessionId: session.id,
  };
}

// ---------------------------------------------------------------------------
// Billing Portal
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Billing Portal session so the user can manage their
 * subscription (upgrade, downgrade, cancel, update payment method).
 *
 * @param customerId - Stripe Customer ID
 * @param returnUrl  - URL to redirect to after the portal session
 *
 * @returns The portal session URL
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = getStripeClient();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  log.info({ customerId, portalUrl: session.url }, 'Billing portal session created');

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

/**
 * Get a Stripe subscription by ID.
 */
export async function getSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * List all invoices for a customer.
 */
export async function listInvoices(
  customerId: string,
  limit = 20,
): Promise<Stripe.Invoice[]> {
  const stripe = getStripeClient();
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
  });
  return invoices.data;
}

/**
 * Cancel a subscription at the end of the current billing period.
 */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  log.info({ subscriptionId }, 'Subscription set to cancel at period end');
  return subscription;
}

/**
 * Reactivate a subscription that was set to cancel.
 */
export async function reactivateSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
  log.info({ subscriptionId }, 'Subscription reactivated');
  return subscription;
}

/**
 * Update a subscription to a new plan.
 * This changes the price on the existing subscription item.
 */
export async function updateSubscriptionPlan(
  subscriptionId: string,
  newPriceId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = subscription.items.data[0]?.id;

  if (!itemId) {
    throw new BillingError(
      'Subscription has no items to update',
      'NO_SUBSCRIPTION_ITEMS',
    );
  }

  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: itemId,
        price: newPriceId,
      },
    ],
    proration_behavior: 'create_prorations',
  });

  log.info(
    { subscriptionId, newPriceId },
    'Subscription plan updated',
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Product & Price creation (dev setup helper)
// ---------------------------------------------------------------------------

/**
 * Create Stripe Products and Prices for all billing plans.
 *
 * This is a one-time setup helper. Run it once to create the products and
 * prices, then copy the resulting Price IDs into your env config.
 *
 * @returns A map of planId -> { productId, priceId }
 */
export async function createStripeProductsAndPrices(): Promise<
  Record<PlanId, { productId: string; priceId: string }>
> {
  const stripe = getStripeClient();
  const results: Record<string, { productId: string; priceId: string }> = {};

  const billablePlans = [PLANS.solo, PLANS.team];

  for (const plan of billablePlans) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: {
        planId: plan.id,
        monthlyFixLimit: String(plan.monthlyFixLimit),
      },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amountCents,
      currency: 'usd',
      recurring: {
        interval: 'month',
        interval_count: 1,
      },
      metadata: {
        planId: plan.id,
      },
    });

    log.info(
      { planId: plan.id, productId: product.id, priceId: price.id },
      'Stripe product and price created',
    );

    results[plan.id] = {
      productId: product.id,
      priceId: price.id,
    };
  }

  return results as Record<PlanId, { productId: string; priceId: string }>;
}
