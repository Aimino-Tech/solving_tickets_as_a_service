/**
 * Stripe subscription webhook handler.
 *
 * Handles Stripe subscription lifecycle events:
 *   - checkout.session.completed   -> Activate subscription in database
 *   - invoice.paid                 -> Update billing period
 *   - customer.subscription.updated -> Plan change / status update
 *   - customer.subscription.deleted -> Cancellation / downgrade to free
 *
 * ── Error Handling ────────────────────────────────────────────────────────────
 * ✅ Missing STRIPE_WEBHOOK_SECRET returns 500
 * ✅ Missing raw body returns 400
 * ✅ Invalid signature returns 401
 * ✅ Unknown events are logged and acknowledged (200)
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { captureEvent } from '../analytics/tracker.js';
import { queryWithRetry } from '../db/connection.js';
import { getSupabaseAdmin } from '../auth/supabase.js';
import { getPlanByPriceId } from './plans.js';
import type { PlanId } from './plans.js';


interface StripeSubscriptionWithPeriod extends Stripe.Subscription {
  current_period_start: number;
  current_period_end: number;
}
const log = rootLogger.child({ module: 'billing-webhook' });

// ---------------------------------------------------------------------------
// Stripe client
// ---------------------------------------------------------------------------

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
 * Reset the cached Stripe client (useful for tests).
 */
export function resetBillingWebhookClient(): void {
  _stripe = null;
}

// ---------------------------------------------------------------------------
// Webhook handler factory
// ---------------------------------------------------------------------------

/**
 * Create an Express request handler for Stripe subscription webhooks.
 *
 * The route using this handler MUST register `express.raw({ type: 'application/json' })`
 * middleware so that the raw body buffer is available for signature verification.
 */
export function createBillingWebhookHandler(): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    const webhookSecret = config.stripe.webhookSecret;
    if (!webhookSecret) {
      log.error('STRIPE_WEBHOOK_SECRET is not configured — cannot verify webhook');
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
      log.warn('Missing stripe-signature header');
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

    log.info({ type: event.type, id: event.id }, 'Received Stripe subscription webhook event');

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
        case 'customer.subscription.updated': {
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        }
        case 'customer.subscription.deleted': {
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        }
        default: {
          log.debug({ type: event.type }, 'Unhandled Stripe subscription webhook event type');
        }
      }
    } catch (err) {
      // Log but don't rethrow — Stripe expects 200 to acknowledge receipt
      log.error(
        { err: String(err), type: event.type, id: event.id },
        'Error processing Stripe subscription webhook event',
      );
    }

    res.status(200).json({ received: true });
  };
}

// ---------------------------------------------------------------------------
// Plan sync helpers — propagate Stripe subscription state to users table
// and Supabase Auth metadata (best-effort, non-blocking on error).
// ---------------------------------------------------------------------------

/**
 * Resolve the local `user_id` for a given account from the accounts table.
 * Returns `null` for legacy GitHub-only accounts that have no user link.
 */
async function resolveUserIdFromAccount(accountId: number): Promise<string | null> {
  try {
    const result = await queryWithRetry<{ user_id: string }>(
      'SELECT user_id FROM accounts WHERE id = $1 AND user_id IS NOT NULL LIMIT 1',
      [accountId],
    );
    return result.rows[0]?.user_id ?? null;
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to resolve user_id from account');
    return null;
  }
}

/**
 * Sync subscription changes to the local `users` table.
 * Resolves the user via `resolveUserIdFromAccount`; no-op if the account has no linked user.
 * Errors are logged but not thrown (non-blocking).
 */
async function syncPlanToUser(
  accountId: number,
  planId: PlanId,
  subscriptionId: string | null,
  customerId: string,
  status: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
): Promise<void> {
  try {
    const userId = await resolveUserIdFromAccount(accountId);
    if (!userId) {
      log.debug({ accountId }, 'No user linked to account — skipping users table sync');
      return;
    }

    await queryWithRetry(
      `UPDATE users
       SET plan = $1,
           subscription_status = $2,
           subscription_id = $3,
           stripe_customer_id = $4,
           trial_start = $5,
           trial_end = $6,
           updated_at = NOW()
       WHERE id = $7::uuid`,
      [planId, status, subscriptionId, customerId, currentPeriodStart.toISOString(), currentPeriodEnd.toISOString(), userId],
    );

    log.info({ accountId, userId, planId, status }, 'Synced plan to users table');
  } catch (err) {
    log.error({ err: String(err), accountId, planId }, 'Failed to sync plan to users table');
  }
}

/**
 * Sync the user's plan into Supabase Auth `raw_app_meta_data` so JWT tokens
 * carry the plan claim. Best-effort — errors are logged but not thrown.
 *
 * 1. Looks up `supabase_uid` from the local `users` table.
 * 2. Calls Supabase Auth Admin API to merge `{"plan": "..."}` into `app_metadata`.
 */
async function syncPlanToAuthMetadata(userId: string, plan: string): Promise<void> {
  try {
    const userResult = await queryWithRetry<{ supabase_uid: string | null }>(
      'SELECT supabase_uid FROM users WHERE id = $1::uuid',
      [userId],
    );
    const supabaseUid = userResult.rows[0]?.supabase_uid;
    if (!supabaseUid) {
      log.debug({ userId }, 'No supabase_uid found for user — skipping auth metadata sync');
      return;
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.auth.admin.updateUserById(supabaseUid, {
      app_metadata: { plan },
    });

    if (error) {
      log.error({ err: String(error), userId, supabaseUid }, 'Failed to update auth metadata');
      return;
    }

    log.info({ userId, plan }, 'Synced plan to auth metadata');
  } catch (err) {
    log.error({ err: String(err), userId, plan }, 'Failed to sync plan to auth metadata');
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handle `checkout.session.completed` — activate subscription in the database.
 *
 * Reads `metadata.accountId` and `metadata.planId` from the session, looks up
 * the Stripe subscription, and creates/updates the billing record.
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const accountId = session.metadata?.accountId;
  const planId = session.metadata?.planId as PlanId | undefined;
  const subscriptionId = session.subscription?.toString();

  if (!accountId || !planId || !subscriptionId) {
    log.warn(
      { sessionId: session.id, accountId, planId, subscriptionId },
      'Checkout session completed but missing required metadata',
    );
    return;
  }

  // Fetch the subscription to get current period dates
  let subscription: Stripe.Subscription;
  try {
    const stripe = getStripe();
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    log.error(
      { err: String(err), subscriptionId },
      'Failed to retrieve subscription after checkout',
    );
    return;
  }

  const subWithPeriod = subscription as StripeSubscriptionWithPeriod;
  const currentPeriodStart = new Date(subWithPeriod.current_period_start * 1000);
  const currentPeriodEnd = new Date(subWithPeriod.current_period_end * 1000);
  const customerId = subscription.customer?.toString() ?? session.customer?.toString() ?? '';

  log.info(
    {
      accountId: Number(accountId),
      planId,
      subscriptionId,
      customerId,
      currentPeriodStart: currentPeriodStart.toISOString(),
      currentPeriodEnd: currentPeriodEnd.toISOString(),
    },
    'Activating subscription after successful checkout',
  );

  // Upsert billing record
  await queryWithRetry(
    `INSERT INTO billing (account_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, $4, 'active', $5, $6)
     ON CONFLICT (account_id)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       plan = EXCLUDED.plan,
       status = 'active',
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       usage_count = 0`,
    [
      Number(accountId),
      customerId,
      subscriptionId,
      planId,
      currentPeriodStart.toISOString(),
      currentPeriodEnd.toISOString(),
    ],
  );

  // Sync plan to users table and auth metadata (best-effort)
  const checkoutUserId = await resolveUserIdFromAccount(Number(accountId));
  await syncPlanToUser(
    Number(accountId),
    planId,
    subscriptionId,
    customerId,
    'active',
    currentPeriodStart,
    currentPeriodEnd,
  );
  if (checkoutUserId) {
    await syncPlanToAuthMetadata(checkoutUserId, planId);
  }

  // Track user conversion in PostHog
  try {
    captureEvent('user_converted', String(accountId), {
      planId,
      subscriptionId,
      customerId,
    });
  } catch (analyticsErr) {
    log.error({ err: String(analyticsErr) }, 'Failed to track user_converted event');
  }
}

/**
 * Handle `invoice.paid` — update billing period dates.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = (invoice as { subscription?: unknown }).subscription?.toString();
  if (!subscriptionId) {
    log.warn({ invoiceId: invoice.id }, 'Invoice paid but no subscription ID');
    return;
  }

  // Fetch subscription for current period dates
  let subscription: Stripe.Subscription;
  try {
    const stripe = getStripe();
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    log.error({ err: String(err), subscriptionId }, 'Failed to retrieve subscription after invoice paid');
    return;
  }

  const subWithPeriod = subscription as StripeSubscriptionWithPeriod;
  const currentPeriodStart = new Date(subWithPeriod.current_period_start * 1000);
  const currentPeriodEnd = new Date(subWithPeriod.current_period_end * 1000);

  log.info(
    {
      subscriptionId,
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
      currentPeriodStart: currentPeriodStart.toISOString(),
      currentPeriodEnd: currentPeriodEnd.toISOString(),
    },
    'Invoice paid — updating billing period',
  );

  // Update billing period and reset usage count for new period
  await queryWithRetry(
    `UPDATE billing
     SET current_period_start = $1,
         current_period_end = $2,
         usage_count = 0,
         status = 'active'
     WHERE stripe_subscription_id = $3`,
    [currentPeriodStart.toISOString(), currentPeriodEnd.toISOString(), subscriptionId],
  );
}

/**
 * Handle `customer.subscription.updated` — plan change or status update.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer?.toString() ?? '';
  const subscriptionId = subscription.id;
  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const plan = getPlanByPriceId(priceId);
  const planId = plan?.id ?? 'free';
  const status = subscription.status === 'active' ? 'active' : subscription.status === 'past_due' ? 'past_due' : 'canceled';
  const subWithPeriod = subscription as StripeSubscriptionWithPeriod;
  const currentPeriodStart = new Date(subWithPeriod.current_period_start * 1000);
  const currentPeriodEnd = new Date(subWithPeriod.current_period_end * 1000);

  log.info(
    {
      subscriptionId,
      customerId,
      priceId,
      planId,
      status,
      currentPeriodStart: currentPeriodStart.toISOString(),
      currentPeriodEnd: currentPeriodEnd.toISOString(),
    },
    'Subscription updated',
  );

  await queryWithRetry(
    `UPDATE billing
     SET plan = $1,
         status = $2,
         current_period_start = $3,
         current_period_end = $4
     WHERE stripe_subscription_id = $5`,
    [planId, status, currentPeriodStart.toISOString(), currentPeriodEnd.toISOString(), subscriptionId],
  );

  // Sync plan to users table and auth metadata (best-effort)
  const updateBillingRow = await queryWithRetry<{ account_id: number }>(
    'SELECT account_id FROM billing WHERE stripe_subscription_id = $1 LIMIT 1',
    [subscriptionId],
  );
  const updateAccountId = updateBillingRow.rows[0]?.account_id;
  if (updateAccountId) {
    const updateUserId = await resolveUserIdFromAccount(updateAccountId);
    await syncPlanToUser(
      updateAccountId,
      planId,
      subscriptionId,
      customerId,
      status,
      currentPeriodStart,
      currentPeriodEnd,
    );
    if (updateUserId) {
      await syncPlanToAuthMetadata(updateUserId, planId);
    }
  }
}

/**
 * Handle `customer.subscription.deleted` — downgrade account to free tier.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const subscriptionId = subscription.id;

  log.info(
    { subscriptionId },
    'Subscription deleted — downgrading account to free tier',
  );

  await queryWithRetry(
    `UPDATE billing
     SET plan = 'free',
         status = 'canceled',
         stripe_subscription_id = NULL
     WHERE stripe_subscription_id = $1`,
    [subscriptionId],
  );

  // Sync plan to users table and auth metadata (best-effort)
  const deletedBillingRow = await queryWithRetry<{ account_id: number }>(
    'SELECT account_id FROM billing WHERE stripe_subscription_id = $1 LIMIT 1',
    [subscriptionId],
  );
  const deleteAccountId = deletedBillingRow.rows[0]?.account_id;
  if (deleteAccountId) {
    const deleteUserId = await resolveUserIdFromAccount(deleteAccountId);
    const deleteSubWithPeriod = subscription as StripeSubscriptionWithPeriod;
    await syncPlanToUser(
      deleteAccountId,
      'free' as PlanId,
      null,
      subscription.customer?.toString() ?? '',
      'canceled',
      new Date(deleteSubWithPeriod.current_period_start * 1000),
      new Date(deleteSubWithPeriod.current_period_end * 1000),
    );
    if (deleteUserId) {
      await syncPlanToAuthMetadata(deleteUserId, 'free');
    }
  }

  // Track user cancellation in PostHog
  try {
    const customerId = subscription.customer?.toString() ?? '';
    captureEvent('user_canceled', customerId, {
      subscriptionId,
    });
  } catch (analyticsErr) {
    log.error({ err: String(analyticsErr) }, 'Failed to track user_canceled event');
  }
}
