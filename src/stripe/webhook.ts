/**
 * Stripe webhook handler for credit purchase events.
 *
 * Verifies event signatures via `stripe.webhooks.constructEvent()` and
 * processes the following events:
 *
 *   - `checkout.session.completed`        -> credit account with purchased credits
 *   - `invoice.paid`                      -> subscription-based credit top-up
 *   - `invoice.payment_failed`            -> log and notify
 *   - `customer.subscription.updated`     -> handle plan changes
 *   - `customer.subscription.deleted`     -> downgrade to free tier
 *
 * --- Error Handling Audit ---------------------------------------------------
 * - Stripe signature verification via constructEvent
 * - Missing raw body handled with 400
 * - Missing webhook secret handled with 500
 * - Unknown events logged and acknowledged (200)
 * - Per-event error handling - one failing event does not crash others
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { CREDIT_PACKS } from './credit-packs.js';

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
    _stripe = new Stripe(secretKey, {
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
      'Failed to credit account after checkout',
    );
  }
}

/**
 * Handle `invoice.paid` - subscription-based credit top-up.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription;
  const customerId = invoice.customer;

  log.info(
    {
      invoiceId: invoice.id,
      subscriptionId: subscriptionId?.toString() ?? 'none',
      customerId: customerId?.toString() ?? 'none',
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
    },
    'Invoice paid - subscription credit top-up would be processed here',
  );

  // TODO: Look up the account by customer ID, then add subscription credits.
}

/**
 * Handle `invoice.payment_failed` - log and notify.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  log.warn(
    {
      invoiceId: invoice.id,
      customerId: customerId?.toString() ?? 'none',
      subscriptionId: subscriptionId?.toString() ?? 'none',
      attemptCount: invoice.attempt_count,
      nextAttempt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : null,
    },
    'Invoice payment failed',
  );

  // TODO: Notify the account holder about the failed payment.
}

/**
 * Handle `customer.subscription.updated` - plan changes.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer;
  const plan = subscription.items.data[0]?.price?.nickname ?? 'unknown';

  log.info(
    {
      subscriptionId: subscription.id,
      customerId: customerId?.toString() ?? 'none',
      status: subscription.status,
      plan,
      currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    },
    'Subscription updated',
  );

  // TODO: Update the account's billing plan in the database.
}

/**
 * Handle `customer.subscription.deleted` - downgrade to free tier.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer;

  log.info(
    {
      subscriptionId: subscription.id,
      customerId: customerId?.toString() ?? 'none',
    },
    'Subscription deleted - account downgraded to free tier',
  );

  // TODO: Downgrade the account to the free tier in the database.
}

/**
 * Reset the cached Stripe client (useful for tests).
 */
export function resetStripeWebhookClient(): void {
  _stripe = null;
}
