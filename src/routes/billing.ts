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
import { rootLogger } from '../utils/logger.js';
import { PLANS } from '../billing/plans.js';
import type { PlanId } from '../billing/plans.js';
import { createSubscriptionCheckoutSession } from '../billing/stripe.js';
import { createBillingWebhookHandler } from '../billing/webhook.js';

const log = rootLogger.child({ module: 'billing-api' });

const router = Router();

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

export { router as billingRouter };
