/**
 * Stripe Checkout session creation for credit purchases.
 *
 * Creates a Stripe Checkout Session that, upon completion, credits
 * the user's account with the purchased credits. The account ID and
 * credit pack key are stored in the session metadata so the webhook
 * handler can process the fulfilment.
 */

import Stripe from 'stripe';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { CreditPackKey } from './credit-packs.js';
import { CREDIT_PACKS } from './credit-packs.js';

const log = rootLogger.child({ module: 'stripe-checkout' });

/**
 * Get-or-create the Stripe client instance.
 * Lazily initialised so the module can load without STRIPE_SECRET_KEY set.
 */
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = config.stripe.secretKey;
    if (!secretKey) {
      throw new Error(
        'STRIPE_SECRET_KEY is not configured. Set it in your environment to enable credit purchases.',
      );
    }
    _stripe = new Stripe(secretKey, {
      apiVersion: '2026-05-27.dahlia',
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Create a Stripe Checkout session for a credit purchase.
 *
 * @param opts.accountId - The internal account ID to credit on success.
 * @param opts.priceId   - The Stripe Price ID for the desired credit pack.
 * @param opts.successUrl - Redirect URL on successful payment.
 * @param opts.cancelUrl  - Redirect URL if the user cancels.
 *
 * @returns The Checkout session URL (for redirect) and session ID.
 */
export async function createCheckoutSession(opts: {
  accountId: number;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const { accountId, priceId, successUrl, cancelUrl } = opts;

  // Validate the price ID matches a known credit pack
  const pack = Object.entries(CREDIT_PACKS).find(
    ([, p]) => p.priceId === priceId,
  );

  if (!pack) {
    throw new Error(
      `Unknown price ID "${priceId}". Must be one of: ${Object.values(CREDIT_PACKS).map((p) => p.priceId).join(', ')}`,
    );
  }

  const [packKey] = pack as [CreditPackKey, (typeof CREDIT_PACKS)[CreditPackKey]];

  log.info({ accountId, priceId, packKey }, 'Creating Stripe Checkout session');

  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      accountId: String(accountId),
      creditPack: packKey,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url || !session.id) {
    throw new Error('Stripe Checkout session creation returned no URL or session ID');
  }

  log.info(
    { sessionId: session.id, accountId, packKey },
    'Stripe Checkout session created',
  );

  return {
    url: session.url,
    sessionId: session.id,
  };
}

/**
 * Reset the cached Stripe client (useful for tests).
 */
export function resetStripeClient(): void {
  _stripe = null;
}
