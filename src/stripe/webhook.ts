/**
 * Stripe webhook handler for credit purchase events.
 *
 * Verifies event signatures via `stripe.webhooks.constructEvent()` and
 * processes the following events:
 *
 *   - `checkout.session.completed`        -> credit account with purchased credits
 *   - `invoice.paid`                      -> subscription-based credit top-up
 *   - `invoice.payment_failed`            -> log and notify account holder
 *   - `customer.subscription.updated`     -> sync billing plan in database
 *   - `customer.subscription.deleted`     -> downgrade to free tier
 *
 * --- Error Handling Audit ---------------------------------------------------
 * - Stripe signature verification via constructEvent
 * - Missing raw body handled with 400
 * - Missing webhook secret handled with 500
 * - Unknown events logged and acknowledged (200)
 * - Per-event error handling - one failing event does not crash others
 * - Database lookups for customer-to-account mapping are wrapped in try/catch
 * - Notification failures are non-fatal (logged but don't throw)
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { billingRepository } from '../db/repositories/BillingRepository.js';
import { accountsRepository } from '../db/repositories/AccountsRepository.js';
import { createSlackNotifier } from '../notifications/index.js';
import { CREDIT_PACKS } from './credit-packs.js';

interface StripeSubscriptionWithPeriod extends Stripe.Subscription {
  current_period_start: number;
  current_period_end: number;
}

const log = rootLogger.child({ module: 'stripe-webhook' });

/**
 * Get-or-create the Stripe client instance.
 */
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = config.stripe.secretKey;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured.');
    }
    _stripe = new (Stripe as unknown as { new(key: string, config?: Record<string, unknown>): Stripe })(secretKey, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Create an Express request handler for Stripe webhooks.
 *
 * The route using this handler MUST register `express.raw({ type: 'application/json' })`
 * middleware so that the raw body buffer is available for signature verification.
 */
export function createStripeWebhookHandler(): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    const webhookSecret = config.stripe.webhookSecret;
    if (!webhookSecret) {
      log.error('STRIPE_WEBHOOK_SECRET is not configured - cannot verify webhook');
      res.status(500).json({ error: 'Stripe webhook secret not configured' });
      return;
    }

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      log.error('Missing raw body for Stripe webhook signature verification');
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      log.warn('Missing Stripe signature header');
      res.status(401).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      log.warn({ err: String(err) }, 'Stripe webhook signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    log.info({ type: event.type, id: event.id }, 'Received Stripe webhook event');

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        }
        case 'invoice.paid': {
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        }
        case 'invoice.payment_failed': {
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        }
        case 'customer.subscription.updated': {
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        }
        case 'customer.subscription.deleted': {
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        }
        default: {
          log.debug({ type: event.type }, 'Unhandled Stripe webhook event type');
        }
      }
    } catch (err) {
      // Log but don't rethrow - Stripe expects 200 to acknowledge receipt
      log.error(
        { err: String(err), type: event.type, id: event.id },
        'Error processing Stripe webhook event',
      );
    }

    res.status(200).json({ received: true });
  };
}

// --- Event Handlers ---------------------------------------------------------

/**
 * Handle `checkout.session.completed` - credit the account with purchased credits.
 *
 * Reads `metadata.accountId` and `metadata.creditPack` from the session,
 * looks up the credit pack, and credits the account.
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const accountId = session.metadata?.accountId;
  const creditPackKey = session.metadata?.creditPack;

  if (!accountId || !creditPackKey) {
    log.warn(
      { sessionId: session.id },
      'Checkout session completed but missing accountId or creditPack metadata',
    );
    return;
  }

  const pack = CREDIT_PACKS[creditPackKey as keyof typeof CREDIT_PACKS];
  if (!pack) {
    log.warn(
      { sessionId: session.id, creditPackKey },
      'Unknown credit pack key in session metadata',
    );
    return;
  }

  const totalCredits = pack.credits + pack.bonus;

  log.info(
    {
      sessionId: session.id,
      accountId: Number(accountId),
      creditPack: creditPackKey,
      creditsPurchased: pack.credits,
      bonusCredits: pack.bonus,
      totalCredits,
      amountPaid: session.amount_total ?? 0,
    },
    'Crediting account after successful checkout',
  );

  try {
    await creditsRepository.credit(Number(accountId), totalCredits, {
      type: 'purchase',
      description: `Purchased ${pack.label} — ${pack.credits} credits + ${pack.bonus} bonus`,
      stripePaymentIntentId: session.payment_intent?.toString(),
    });
    const balance = await creditsRepository.getBalance(Number(accountId));
    log.info(
      { accountId: Number(accountId), creditsAdded: totalCredits, newBalance: balance.balance },
      'Account credited after successful checkout',
    );
  } catch (err) {
    log.error(
      { err: String(err), accountId: Number(accountId), sessionId: session.id },
      'Failed to credit account after checkout — manual reconciliation required',
    );
  }
}

/**
 * Handle `invoice.paid` - subscription-based credit top-up.
 *
 * Looks up the account by Stripe customer ID, then adds the
 * subscription monthly credits to their balance.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer;
  const subscriptionId = (invoice as { subscription?: unknown }).subscription?.toString() ?? null;

  log.info(
    {
      invoiceId: invoice.id,
      subscriptionId: subscriptionId ?? 'none',
      customerId: customerId?.toString() ?? 'none',
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
    },
    'Invoice paid - processing subscription credit top-up',
  );

  if (!customerId) {
    log.warn({ invoiceId: invoice.id }, 'Invoice paid but no customer ID');
    return;
  }

  try {
    // Look up the account by Stripe customer ID
    const billing = await billingRepository.findByStripeCustomerId(customerId.toString());
    if (!billing) {
      log.warn(
        { invoiceId: invoice.id, customerId: customerId.toString() },
        'No billing record found for customer - cannot add subscription credits',
      );
      return;
    }

    // Credit the account with the monthly subscription allotment
    const subscriptionCredits = config.metering.freeMonthlyCredits;
    await creditsRepository.credit(billing.accountId, subscriptionCredits, {
      type: 'subscription',
      description: `Monthly subscription credit top-up (invoice ${invoice.id})`,
      stripePaymentIntentId: invoice.payment_intent?.toString(),
    });

    const balance = await creditsRepository.getBalance(billing.accountId);
    log.info(
      { accountId: billing.accountId, creditsAdded: subscriptionCredits, newBalance: balance.balance },
      'Account credited with subscription credits after invoice paid',
    );
  } catch (err) {
    log.error(
      { err: String(err), invoiceId: invoice.id, customerId: customerId?.toString() },
      'Failed to process subscription credit top-up after invoice paid',
    );
  }
}

/**
 * Handle `invoice.payment_failed` - notify the account holder.
 *
 * Looks up the account by Stripe customer ID and sends a notification
 * via the configured notification service (Slack/email).
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer;
  const subscriptionId = (invoice as { subscription?: unknown }).subscription?.toString() ?? null;

  log.warn(
    {
      invoiceId: invoice.id,
      customerId: customerId?.toString() ?? 'none',
      subscriptionId: subscriptionId ?? 'none',
      attemptCount: invoice.attempt_count,
      nextAttempt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : null,
    },
    'Invoice payment failed',
  );

  if (!customerId) {
    log.warn({ invoiceId: invoice.id }, 'Invoice payment failed but no customer ID - cannot notify');
    return;
  }

  try {
    // Look up the account by Stripe customer ID
    const billing = await billingRepository.findByStripeCustomerId(customerId.toString());
    if (!billing) {
      log.warn(
        { invoiceId: invoice.id, customerId: customerId.toString() },
        'No billing record found for customer - cannot send payment failure notification',
      );
      return;
    }

    const account = await accountsRepository.findById(billing.accountId);

    // Build notification metadata
    const metadata: Record<string, unknown> = {
      invoiceId: invoice.id,
      subscriptionId,
      amountCents: invoice.amount_due,
      currency: invoice.currency,
      attemptCount: invoice.attempt_count,
      nextAttempt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : null,
    };

    // Send notification via Slack
    const notifier = createSlackNotifier();
    await notifier.sendNotification('payment_failed', {
      repoOwner: '',
      repoName: '',
      issueNumber: 0,
      issueTitle: 'Stripe Payment Failed',
      reason: `Invoice ${invoice.id} for ${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()} failed after ${invoice.attempt_count} attempt(s).`,
      email: account?.email ?? undefined,
      botName: config.stas.botName,
      metadata,
    });

    log.info(
      { accountId: billing.accountId, invoiceId: invoice.id },
      'Payment failure notification sent',
    );
  } catch (err) {
    log.error(
      { err: String(err), invoiceId: invoice.id, customerId: customerId?.toString() },
      'Failed to send payment failure notification',
    );
  }
}

/**
 * Handle `customer.subscription.updated` - sync billing plan in the database.
 *
 * Maps the Stripe subscription's price ID to the corresponding STAS plan
 * and updates the billing record for the account.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const sub = subscription as unknown as Record<string, unknown>;
  const customerId = subscription.customer;
  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const planNickname = subscription.items.data[0]?.price?.nickname ?? 'unknown';
  const sub = subscription as StripeSubscriptionWithPeriod;

  log.info(
    {
      subscriptionId: subscription.id,
      customerId: customerId?.toString() ?? 'none',
      status: subscription.status,
      plan: planNickname,
      priceId,
      currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    },
    'Subscription updated - syncing billing plan',
  );

  if (!customerId) {
    log.warn({ subscriptionId: subscription.id }, 'Subscription updated but no customer ID');
    return;
  }

  try {
    // Look up the account by Stripe customer ID
    const billing = await billingRepository.findByStripeCustomerId(customerId.toString());
    if (!billing) {
      log.warn(
        { subscriptionId: subscription.id, customerId: customerId.toString() },
        'No billing record found for customer - cannot update billing plan',
      );
      return;
    }

    // Map Stripe price ID to STAS plan ID
    let planId: string;
    if (priceId === config.stripe.soloPriceId) {
      planId = 'solo';
    } else if (priceId === config.stripe.teamPriceId) {
      planId = 'team';
    } else {
      // Fall back to checking all known plan price IDs
      const { getPlanByPriceId } = await import('../billing/plans.js');
      const matchedPlan = getPlanByPriceId(priceId);
      planId = matchedPlan?.id ?? 'free';
    }

    const status = subscription.status === 'active'
      ? 'active'
      : subscription.status === 'past_due'
        ? 'past_due'
        : 'canceled';

    const currentPeriodStart = new Date(sub.current_period_start * 1000);
    const currentPeriodEnd = new Date(sub.current_period_end * 1000);

    await billingRepository.update(billing.accountId, {
      plan: planId,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      stripeSubscriptionId: subscription.id,
    });

    // Also sync the account-level tier field
    const tier =
      planId === 'enterprise' ? 'enterprise'
      : planId === 'solo' || planId === 'team' ? 'pro'
      : 'free';

    await accountsRepository.update(billing.accountId, {
      tier,
    });

    log.info(
      { accountId: billing.accountId, subscriptionId: subscription.id, planId, tier },
      'Billing plan synced to database after subscription update',
    );
  } catch (err) {
    log.error(
      { err: String(err), subscriptionId: subscription.id, customerId: customerId?.toString() },
      'Failed to sync billing plan in database',
    );
  }
}

/**
 * Handle `customer.subscription.deleted` - downgrade the account to the free tier.
 *
 * Updates both the billing record (plan, status, clears subscription ID)
 * and the account record (tier) to reflect the free tier.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer;

  log.info(
    {
      subscriptionId: subscription.id,
      customerId: customerId?.toString() ?? 'none',
    },
    'Subscription deleted - downgrading account to free tier',
  );

  if (!customerId) {
    log.warn({ subscriptionId: subscription.id }, 'Subscription deleted but no customer ID');
    return;
  }

  try {
    // Look up the account by Stripe customer ID
    const billing = await billingRepository.findByStripeCustomerId(customerId.toString());
    if (!billing) {
      log.warn(
        { subscriptionId: subscription.id, customerId: customerId.toString() },
        'No billing record found for customer - cannot downgrade',
      );
      return;
    }

    // Downgrade billing record to free tier
    await billingRepository.update(billing.accountId, {
      plan: 'free',
      status: 'canceled',
      stripeSubscriptionId: null,
    });

    // Also update the account-level tier
    await accountsRepository.update(billing.accountId, {
      tier: 'free',
    });

    log.info(
      { accountId: billing.accountId, subscriptionId: subscription.id },
      'Account downgraded to free tier after subscription deletion',
    );
  } catch (err) {
    log.error(
      { err: String(err), subscriptionId: subscription.id, customerId: customerId?.toString() },
      'Failed to downgrade account to free tier',
    );
  }
}

/**
 * Reset the cached Stripe client (useful for tests).
 */
export function resetStripeWebhookClient(): void {
  _stripe = null;
}
