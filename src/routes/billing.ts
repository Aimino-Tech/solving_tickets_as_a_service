/**
 * Billing API routes — Stripe webhook handler, plans listing, checkout creation.
 *
 * Mounted at /api/billing. These are the public-facing billing endpoints that
 * the frontend and Stripe webhook call into. Underlying billing logic lives
 * in src/billing/ (plans, stripe client, usage tracking).
 *
 * Routes:
 *   GET  /api/billing/plans             — List all subscription plans
 *   POST /api/billing/create-checkout   — Create a Stripe Checkout Session
 *   POST /api/billing/webhook           — Stripe webhook receiver (raw body)
 *
 * ── Security ──────────────────────────────────────────────────────────────────
 * - /plans is public (no auth required)
 * - /create-checkout requires x-account-id header (set by auth middleware)
 * - /webhook uses Stripe signature verification (raw body required)
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { rootLogger } from '../utils/logger.js';
import { PLANS } from '../billing/plans.js';
import type { PlanId } from '../billing/plans.js';
import { createSubscriptionCheckoutSession } from '../billing/stripe.js';
import { createBillingWebhookHandler } from '../billing/webhook.js';
import { queryWithRetry } from '../db/connection.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { accountsRepository } from '../db/repositories/AccountsRepository.js';
import { billingRepository } from '../db/repositories/BillingRepository.js';
import { CREDIT_PACKS } from '../stripe/credit-packs.js';

const log = rootLogger.child({ module: 'billing-api' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// Rate limiting: 30 requests per minute per IP on billing endpoints
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helper: extract account ID from request header
// ---------------------------------------------------------------------------

function getAccountId(req: Request): number | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) {
    const id = Number(headerId);
    if (!Number.isNaN(id)) return id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// GET /api/billing/plans — List available subscription plans
// ---------------------------------------------------------------------------

router.get('/plans', (_req: Request, res: Response) => {
  const plans = Object.values(PLANS).map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    amountCents: plan.amountCents,
    monthlyFixLimit: plan.monthlyFixLimit,
    premiumModels: plan.premiumModels,
    concurrentFixes: plan.concurrentFixes,
    customWebhooks: plan.customWebhooks,
    prioritySupport: plan.prioritySupport,
    trialDays: plan.trialDays,
  }));

  res.json({ plans });
});

// ---------------------------------------------------------------------------
// POST /api/billing/create-checkout — Create Stripe Checkout Session
// ---------------------------------------------------------------------------

router.post('/create-checkout', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required. Provide x-account-id header.' });
      return;
    }

    const { planId, successUrl, cancelUrl, customerId, trialDays } = req.body as {
      planId: PlanId;
      successUrl: string;
      cancelUrl: string;
      customerId?: string;
      trialDays?: number;
    };

    if (!planId || !successUrl || !cancelUrl) {
      res.status(400).json({ error: 'Missing required fields: planId, successUrl, cancelUrl' });
      return;
    }

    if (!PLANS[planId]) {
      res.status(400).json({
        error: `Unknown plan "${planId}". Valid plans: ${Object.keys(PLANS).join(', ')}`,
      });
      return;
    }

    const session = await createSubscriptionCheckoutSession({
      accountId,
      planId,
      successUrl,
      cancelUrl,
      customerId,
      trialDays,
    });

    res.json(session);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/webhook — Stripe webhook
//
// IMPORTANT: This route must be registered BEFORE the JSON body parser
// middleware, because Stripe requires the raw body for signature verification.
// In server.ts, the raw body middleware at /webhook/* handles this, but if
// mounting at /api/billing/webhook, add express.raw() middleware explicitly.
// ---------------------------------------------------------------------------

const billingWebhookHandler = createBillingWebhookHandler();

router.post('/webhook', (req: Request, res: Response) => {
  return billingWebhookHandler(req, res);
});

// ---------------------------------------------------------------------------
// POST /api/billing/stripe-event — Stripe event processing (called by n8n)
//
// Called by the n8n Stripe billing workflow after signature verification.
// Accepts the full Stripe event object and processes database operations:
//   - checkout.session.completed → credit account or activate subscription
//   - invoice.paid → update billing period
//   - customer.subscription.updated → sync plan and status
//   - customer.subscription.deleted → downgrade to free tier
// ---------------------------------------------------------------------------

router.post('/stripe-event', async (req: Request, res: Response) => {
  try {
    const event = req.body as { type?: string; data?: { object?: Record<string, unknown> } };
    if (!event?.type || !event?.data?.object) {
      res.status(400).json({ error: 'Invalid Stripe event payload' });
      return;
    }

    log.info({ type: event.type, id: event.data.object.id }, 'Processing Stripe event via n8n');

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Record<string, unknown>;
        if (session.metadata && typeof session.metadata === 'object' && 'creditPack' in session.metadata) {
          await handleCreditPurchase(session);
        } else {
          await handleBillingCheckout(session);
        }
        break;
      }
      case 'invoice.paid': {
        await handleInvoicePaidEvent(event.data.object as Record<string, unknown>);
        break;
      }
      case 'invoice.payment_failed': {
        log.warn({ invoiceId: event.data.object.id }, 'Invoice payment failed — notified via n8n Slack');
        break;
      }
      case 'customer.subscription.updated': {
        await handleSubscriptionUpdatedEvent(event.data.object as Record<string, unknown>);
        break;
      }
      case 'customer.subscription.deleted': {
        await handleSubscriptionDeletedEvent(event.data.object as Record<string, unknown>);
        break;
      }
      default: {
        log.debug({ type: event.type }, 'Unhandled Stripe event type from n8n');
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Error processing Stripe event from n8n');
    res.status(200).json({ received: true, warning: 'Processing error logged' });
  }
});

export { router as billingRouter };

// ---------------------------------------------------------------------------
// Inline event handlers (replicates src/stripe/webhook.ts + src/billing/webhook.ts)
// ---------------------------------------------------------------------------

async function handleCreditPurchase(session: Record<string, unknown>): Promise<void> {
  const metadata = session.metadata as Record<string, string> | undefined;
  const accountId = metadata?.accountId;
  const creditPackKey = metadata?.creditPack;

  if (!accountId || !creditPackKey) {
    log.warn({ sessionId: session.id }, 'Checkout completed but missing accountId or creditPack metadata');
    return;
  }

  const pack = CREDIT_PACKS[creditPackKey as keyof typeof CREDIT_PACKS];
  if (!pack) {
    log.warn({ sessionId: session.id, creditPackKey }, 'Unknown credit pack key');
    return;
  }

  const totalCredits = pack.credits + pack.bonus;
  await creditsRepository.credit(Number(accountId), totalCredits, {
    type: 'purchase',
    description: `Purchased ${pack.label} — ${pack.credits} credits + ${pack.bonus} bonus`,
    stripePaymentIntentId: session.payment_intent?.toString(),
  });

  log.info(
    { accountId: Number(accountId), creditsAdded: totalCredits },
    'Account credited after checkout',
  );
}

async function handleBillingCheckout(session: Record<string, unknown>): Promise<void> {
  const metadata = session.metadata as Record<string, string> | undefined;
  const accountId = metadata?.accountId;
  const planId = metadata?.planId as PlanId | undefined;
  const subscriptionId = session.subscription?.toString();

  if (!accountId || !planId || !subscriptionId) {
    log.warn({ sessionId: session.id, accountId, planId, subscriptionId }, 'Checkout missing required metadata');
    return;
  }

  await queryWithRetry(
    `INSERT INTO billing (account_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW() + INTERVAL '1 month')
     ON CONFLICT (account_id)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       plan = EXCLUDED.plan,
       status = 'active',
       current_period_start = NOW(),
       current_period_end = NOW() + INTERVAL '1 month',
       usage_count = 0`,
    [Number(accountId), session.customer?.toString() ?? '', subscriptionId, planId],
  );

  log.info({ accountId: Number(accountId), planId, subscriptionId }, 'Subscription activated after checkout');
}

async function handleInvoicePaidEvent(invoice: Record<string, unknown>): Promise<void> {
  const subscriptionId = invoice.subscription?.toString();
  if (!subscriptionId) return;

  await queryWithRetry(
    `UPDATE billing
     SET current_period_start = NOW(),
         current_period_end = NOW() + INTERVAL '1 month',
         usage_count = 0,
         status = 'active'
     WHERE stripe_subscription_id = $1`,
    [subscriptionId],
  );

  log.info({ subscriptionId, invoiceId: invoice.id }, 'Billing period updated after invoice paid');
}

async function handleSubscriptionUpdatedEvent(subscription: Record<string, unknown>): Promise<void> {
  const subscriptionId = subscription.id?.toString();
  const items = subscription.items as { data?: Array<{ price?: { id?: string; nickname?: string } }> } | undefined;
  const priceId = items?.data?.[0]?.price?.id ?? '';
  const status = subscription.status === 'active' ? 'active' : subscription.status === 'past_due' ? 'past_due' : 'canceled';

  if (!subscriptionId) return;

  const { getPlanByPriceId } = await import('../billing/plans.js');
  const matchedPlan = getPlanByPriceId(priceId);
  const planId = matchedPlan?.id ?? 'free';

  await queryWithRetry(
    `UPDATE billing
     SET plan = $1, status = $2
     WHERE stripe_subscription_id = $3`,
    [planId, status, subscriptionId],
  );

  log.info({ subscriptionId, planId, status }, 'Subscription plan synced');
}

async function handleSubscriptionDeletedEvent(subscription: Record<string, unknown>): Promise<void> {
  const subscriptionId = subscription.id?.toString();
  if (!subscriptionId) return;

  await queryWithRetry(
    `UPDATE billing
     SET plan = 'free', status = 'canceled', stripe_subscription_id = NULL
     WHERE stripe_subscription_id = $1`,
    [subscriptionId],
  );

  log.info({ subscriptionId }, 'Account downgraded to free tier');
}
