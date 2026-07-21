/**
 * Stripe webhook handler for billing events.
 *
 * Verifies event signatures via `stripe.webhooks.constructEvent()` and then
 * forwards the parsed event to the n8n Stripe billing workflow for routing,
 * formatting, and notification dispatch.
 *
 * This handler DOES NOT perform any business logic - that is delegated to
 * the n8n workflow (see n8n/workflows/stripe-billing.json). Signature
 * verification remains in TypeScript for security.
 *
 * Supported events forwarded to n8n:
 *
 *   - `checkout.session.completed`
 *   - `invoice.paid`
 *   - `invoice.payment_failed`
 *   - `customer.subscription.created`
 *   - `customer.subscription.updated`
 *   - `customer.subscription.deleted`
 *
 * --- Error Handling Audit ---------------------------------------------------
 * - Stripe signature verification via constructEvent
 * - Missing raw body handled with 400
 * - Missing webhook secret handled with 500
 * - n8n forwarding failures are logged but don't crash the handler
 * - Unknown events logged and acknowledged (200)
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

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
 * Transform a Stripe event into a simplified payload for the n8n webhook.
 *
 * Returns an object with `event`, `type`, and `data` fields that the n8n
 * Stripe billing workflow understands.
 */
function transformEventForN8n(event: Stripe.Event): Record<string, unknown> {
  const base: Record<string, unknown> = {
    event: 'stripe',
    type: event.type,
    data: {},
  };

  const obj = event.data.object as Record<string, unknown> | undefined;
  if (!obj) return base;

  // Extract common billing fields
  const customerId = (obj.customer as string | undefined) ?? '';
  const subscriptionId = (obj.subscription as string | undefined) ?? (obj.id as string | undefined) ?? '';
  const currency = (obj.currency as string | undefined) ?? '';
  const amount =
    (obj.amount_paid as number | undefined) ??
    (obj.amount_due as number | undefined) ??
    (obj.amount as number | undefined) ??
    (obj.total as number | undefined) ??
    0;

  const amountInDollars = typeof amount === 'number' ? amount / 100 : 0;

  // Try to extract customer email from various places
  let customerEmail = (obj.customer_email as string | undefined) ?? '';
  if (!customerEmail && obj.customer_details) {
    customerEmail = ((obj.customer_details as Record<string, unknown>)?.email as string | undefined) ?? '';
  }
  if (!customerEmail && obj.customer_object) {
    customerEmail = ((obj.customer_object as Record<string, unknown>)?.email as string | undefined) ?? '';
  }

  // Extract failure reason for payment failures
  const failureReason =
    (obj.failure_message as string | undefined) ??
    (obj.failure_code as string | undefined) ??
    (obj.last_payment_error as string | undefined) ??
    null;

  // Extract metadata
  const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};

  base.data = {
    customer_id: customerId,
    customer_email: customerEmail,
    subscription_id: subscriptionId,
    amount: amountInDollars,
    amount_cents: amount,
    currency: currency || 'usd',
    failure_reason: failureReason,
    metadata,
  };

  return base;
}

/**
 * Forward the transformed event to the n8n Stripe billing webhook.
 *
 * This is a fire-and-forget operation - failures are logged but do not
 * cause the webhook handler to return an error to Stripe (Stripe requires
 * a 200 to acknowledge receipt).
 */
async function forwardToN8n(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = config.n8n.stripeWebhookUrl;
  if (!webhookUrl) {
    log.warn('N8N_STRIPE_WEBHOOK_URL is not configured - skipping n8n forwarding');
    return;
  }

  log.info({ webhookUrl, type: payload.type }, 'Forwarding Stripe event to n8n');

  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Reasonable timeout to avoid hanging
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.warn(
        { status: response.status, statusText: response.statusText, type: payload.type },
        'n8n webhook returned non-200 status',
      );
    } else {
      log.info({ type: payload.type }, 'Stripe event forwarded to n8n successfully');
    }
  } catch (err) {
    log.error(
      { err: String(err), type: payload.type },
      'Failed to forward Stripe event to n8n',
    );
  }
}

/**
 * Create an Express request handler for Stripe webhooks.
 *
 * The route using this handler MUST register `express.raw({ type: 'application/json' })`
 * middleware so that the raw body buffer is available for signature verification.
 *
 * After verifying the signature, the handler transforms the event and forwards
 * it to the n8n Stripe billing workflow. All business logic (routing, formatting,
 * Slack posting) is handled by n8n.
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

    // Transform and forward to n8n (fire-and-forget - failures are logged)
    const payload = transformEventForN8n(event);
    await forwardToN8n(payload);

    res.status(200).json({ received: true });
  };
}

/**
 * Reset the cached Stripe client (useful for tests).
 */
export function resetStripeWebhookClient(): void {
  _stripe = null;
}
