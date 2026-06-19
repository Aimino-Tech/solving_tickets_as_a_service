/**
 * Billing service entry point.
 *
 * Exports all public API for Stripe subscription billing, plans, trials,
 * usage tracking, and webhook handling.
 *
 * To integrate:
 *   1. Mount `billingRouter` on `/api/v1/billing` in server.ts.
 *   2. Register raw body middleware for `POST /api/v1/billing/webhook`.
 *   3. Run database migrations (005_teams_repos_billing.sql).
 */

import { PLANS, getPlan, getPlanByPriceId, getMonthlyFixLimit, planIdToTier } from './plans.js';
export { PLANS, getPlan, getPlanByPriceId, getMonthlyFixLimit, planIdToTier };
export type { PlanId, Plan } from './plans.js';

export {
  getStripeClient,
  resetStripeClient,
  findOrCreateCustomer,
  getCustomer,
  createSubscriptionCheckoutSession,
  createBillingPortalSession,
  getSubscription,
  listInvoices,
  cancelSubscriptionAtPeriodEnd,
  reactivateSubscription,
  updateSubscriptionPlan,
  createStripeProductsAndPrices,
  BillingError,
} from './stripe.js';

export {
  getTrialStatus,
  startTrial,
  canUseTrial,
  expireTrial,
  getTrialUsage,
  incrementTrialUsage,
  resetTrialUsage,
} from './trial.js';
export type { TrialStatus } from './trial.js';

export {
  getBillingUsage,
  getRemainingBillingUsage,
  hasExceededUsageLimit,
  isUsageAtThreshold,
  incrementBillingUsage,
  resetBillingUsage,
  checkUsageBeforeFix,
  closeUsageRedisClient,
} from './usage.js';
export type { UsageCheckResult } from './usage.js';

export { createBillingWebhookHandler, resetBillingWebhookClient } from './webhook.js';
export { billingRouter } from './routes.js';

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'billing' });

/**
 * Initialize the billing service.
 * Call this once at server startup.
 */
export function initBilling(): void {
  log.info(
    {
      plans: Object.keys(PLANS),
      soloPriceConfigured: !!PLANS.solo.priceId,
      teamPriceConfigured: !!PLANS.team.priceId,
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    },
    'Billing service initialized',
  );
}
