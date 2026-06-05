/**
 * Stripe credit purchase module.
 *
 * Provides Stripe Checkout session creation and webhook event handling
 * for credit purchases and subscription management.
 *
 * Usage:
 *   import { createCheckoutSession } from './stripe/index.js';
 *   const { url } = await createCheckoutSession({
 *     accountId: 42,
 *     priceId: 'price_500credits',
 *     successUrl: 'https://example.com/success',
 *     cancelUrl: 'https://example.com/cancel',
 *   });
 *   // redirect user to `url`
 */

export { createCheckoutSession, resetStripeClient } from './checkout.js';
export type { CreditPackKey, CreditPack } from './credit-packs.js';
export { CREDIT_PACKS, getCreditPackByPriceId, getCreditPack } from './credit-packs.js';
export { createStripeWebhookHandler, resetStripeWebhookClient } from './webhook.js';
