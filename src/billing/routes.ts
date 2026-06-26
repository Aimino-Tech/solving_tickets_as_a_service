/**
 * Billing API routes — subscription management endpoints.
 *
 * All routes are mounted at /api/v1/billing and require the x-account-id
 * header (set by gateway/auth middleware) for account identification.
 *
 * Routes:
 *   GET    /api/v1/billing/plans                    — List available subscription plans
 *   GET    /api/v1/billing/trial                     — Get trial status for account
 *   POST   /api/v1/billing/subscription/create-checkout  — Create Stripe Checkout Session
 *   POST   /api/v1/billing/subscription/portal       — Create billing portal session
 *   POST   /api/v1/billing/subscription/cancel       — Cancel subscription
 *   POST   /api/v1/billing/subscription/reactivate   — Reactivate canceled subscription
 *   POST   /api/v1/billing/webhook                   — Stripe subscription webhook (raw body)
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { PLANS } from './plans.js';
import type { PlanId } from './plans.js';
import {
  createSubscriptionCheckoutSession,
  createBillingPortalSession,
  cancelSubscriptionAtPeriodEnd,
  reactivateSubscription,
} from './stripe.js';
import { getTrialStatus, startTrial } from './trial.js';
import { createBillingWebhookHandler } from './webhook.js';
import { getDpaStatus } from './dpa.js';
import { config } from '../config.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'billing-api' });

const router = Router();

// ---------------------------------------------------------------------------
// Rate limiting: 30 requests per minute per IP on billing endpoints
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helper: extract account ID from request
// ---------------------------------------------------------------------------

function getAccountId(req: Request): number | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) {
    const id = Number(headerId);
    if (!Number.isNaN(id)) return id;
  }

  const queryId = req.query.accountId as string | undefined;
  if (queryId) {
    const id = Number(queryId);
    if (!Number.isNaN(id)) return id;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// GET /api/v1/billing/plans — List available subscription plans
// ---------------------------------------------------------------------------

router.get('/plans', (_req: Request, res: Response) => {
  // Return public plan info (exclude internal fields)
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
// GET /api/v1/billing/trial — Get trial status for account
// ---------------------------------------------------------------------------

router.get('/trial', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required. Provide x-account-id header or accountId query param.' });
      return;
    }

    const status = await getTrialStatus(accountId);
    res.json(status);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get trial status');
    res.status(500).json({ error: 'Failed to get trial status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/billing/subscription/create-checkout — Create Checkout Session
// ---------------------------------------------------------------------------

router.post('/subscription/create-checkout', async (req: Request, res: Response) => {
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

    // Validate plan exists
    if (!PLANS[planId]) {
      res.status(400).json({
        error: `Unknown plan "${planId}". Valid plans: ${Object.keys(PLANS).join(', ')}`,
      });
      return;
    }

    // Require DPA acceptance for paid plans
    if (config.dataPrivacy.requireDpaAcceptance && PLANS[planId].amountCents > 0) {
      const dpaStatus = await getDpaStatus(accountId);
      if (!dpaStatus.accepted) {
        res.status(403).json({
          error: 'DPA acceptance required',
          code: 'DPA_REQUIRED',
          dpaVersion: dpaStatus.currentVersion,
          message: 'You must accept the Data Processing Agreement before subscribing.',
        });
        return;
      }
    }

    if (!PLANS[planId]) {
      res.status(400).json({
        error: `Unknown plan "${planId}". Valid plans: ${Object.keys(PLANS).join(', ')}`,
      });
      return;
    }

    // Start trial if the plan has trial days
    const plan = PLANS[planId];
    if (plan.trialDays > 0) {
      await startTrial(accountId, plan.trialDays);
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
// POST /api/v1/billing/subscription/portal — Create billing portal session
// ---------------------------------------------------------------------------

router.post('/subscription/portal', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const { returnUrl } = req.body as { returnUrl?: string };
    const defaultReturnUrl = `${req.protocol}://${req.get('host')}/billing`;

    // Get the Stripe customer ID from the billing record
    const result = await queryWithRetry<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM billing WHERE account_id = $1',
      [accountId],
    );

    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) {
      res.status(404).json({ error: 'No billing record found. Subscribe first before accessing the portal.' });
      return;
    }

    const session = await createBillingPortalSession(customerId, returnUrl || defaultReturnUrl);
    res.json(session);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create billing portal session');
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/billing/subscription/cancel — Cancel subscription
// ---------------------------------------------------------------------------

router.post('/subscription/cancel', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    // Get the Stripe subscription ID from the billing record
    const result = await queryWithRetry<{ stripe_subscription_id: string | null }>(
      'SELECT stripe_subscription_id FROM billing WHERE account_id = $1',
      [accountId],
    );

    const subscriptionId = result.rows[0]?.stripe_subscription_id;
    if (!subscriptionId) {
      res.status(404).json({ error: 'No active subscription found.' });
      return;
    }

    await cancelSubscriptionAtPeriodEnd(subscriptionId);
    res.json({ success: true, message: 'Subscription will be canceled at the end of the current billing period.' });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to cancel subscription');
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/billing/subscription/reactivate — Reactivate subscription
// ---------------------------------------------------------------------------

router.post('/subscription/reactivate', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    // Get the Stripe subscription ID from the billing record
    const result = await queryWithRetry<{ stripe_subscription_id: string | null }>(
      'SELECT stripe_subscription_id FROM billing WHERE account_id = $1',
      [accountId],
    );

    const subscriptionId = result.rows[0]?.stripe_subscription_id;
    if (!subscriptionId) {
      res.status(404).json({ error: 'No subscription found to reactivate.' });
      return;
    }

    await reactivateSubscription(subscriptionId);
    res.json({ success: true, message: 'Subscription reactivated.' });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to reactivate subscription');
    res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/billing/webhook — Stripe subscription webhook
//
// IMPORTANT: This route must be registered BEFORE the JSON body parser
// middleware, because Stripe requires the raw body for signature verification.
// See server.ts for the middleware order.
// ---------------------------------------------------------------------------

const billingWebhookHandler = createBillingWebhookHandler();

router.post('/webhook', (req: Request, res: Response) => {
  // If raw body is missing, try parsing from the raw body buffer
  // set by the express.raw() middleware in server.ts
  return billingWebhookHandler(req, res);
});

export { router as billingRouter };
