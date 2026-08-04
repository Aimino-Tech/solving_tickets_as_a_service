/**
 * Subscription plan definitions for SYNTARO billing tiers.
 *
 * ── Plans ─────────────────────────────────────────────────────────────────────
 *   Solo     – $49/mo  – 100 fixes/mo, frontier models, 3 concurrent fixes
 *   Team     – $149/mo – 500 fixes/mo, frontier models, 10 concurrent fixes
 *   Enterprise – Custom – unlimited fixes, all features
 *   Free     – $0/mo   – 10 fixes/mo, basic model, 1 concurrent fix (default)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * ── Design ────────────────────────────────────────────────────────────────────
 * Each plan maps to a Stripe Price ID (configured via env vars). The price IDs
 * are required for production but have sensible defaults for development.
 *
 * Plans are used by:
 *   - src/billing/stripe.ts — creating Checkout Sessions and managing subs
 *   - src/billing/routes.ts — exposing plan info via API
 *   - src/pricing/tiers.ts  — mapping subscription plan to feature gates
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanId = 'selfHosted' | 'free' | 'solo' | 'team' | 'enterprise';

/**
 * Full plan definition including Stripe references and limits.
 */
export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Monthly price in cents (e.g., 4900 = $49.00). */
  amountCents: number;
  /** Stripe Price ID for this plan's monthly subscription. */
  priceId: string;
  /** Maximum fixes per billing month. */
  monthlyFixLimit: number;
  /** Whether premium models (claude-sonnet-4, GPT-4o) are available. */
  premiumModels: boolean;
  /** Maximum concurrent fix runs. */
  concurrentFixes: number;
  /** Sandbox timeout in milliseconds. */
  sandboxTimeoutMs: number;
  /** Maximum retry attempts. */
  maxRetries: number;
  /** Whether custom webhook endpoints are available. */
  customWebhooks: boolean;
  /** Whether priority support is included. */
  prioritySupport: boolean;
  /** Trial duration in days (0 = no trial). */
  trialDays: number;
  /** Maximum fixes allowed during trial. */
  trialFixLimit: number;
}

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

/**
 * Get the Stripe price ID for a plan from config.
 */
function getPlanPriceId(planId: PlanId): string {
  switch (planId) {
    case 'solo':
      return config.stripe.soloPriceId;
    case 'team':
      return config.stripe.teamPriceId;
    default:
      return '';
  }
}

/**
 * All subscription plans. The actual Stripe price IDs come from config
 * (which reads from env vars) so they can be set per-environment.
 */
export const PLANS: Record<PlanId, Plan> = {
  selfHosted: {
    id: 'selfHosted',
    name: 'Self-Hosted (OSS)',
    description: 'Unlimited fixes, your API key, your infrastructure',
    amountCents: 0,
    priceId: '',
    monthlyFixLimit: 999_999,
    premiumModels: true,
    concurrentFixes: 10,
    sandboxTimeoutMs: 1_800_000,
    maxRetries: 10,
    customWebhooks: true,
    prioritySupport: false,
    trialDays: 0,
    trialFixLimit: 999_999,
  },
  free: {
    id: 'free',
    name: 'Free',
    description: 'Basic fix runs for individuals and small projects',
    amountCents: 0,
    priceId: '',
    monthlyFixLimit: 50,
    premiumModels: false,
    concurrentFixes: 1,
    sandboxTimeoutMs: 300_000,
    maxRetries: 2,
    customWebhooks: false,
    prioritySupport: false,
    trialDays: 0,
    trialFixLimit: 5,
  },
  solo: {
    id: 'solo',
    name: 'Solo',
    description: 'For individual developers — frontier models, 100 fixes/mo',
    amountCents: 4900,
    priceId: getPlanPriceId('solo'),
    monthlyFixLimit: 100,
    premiumModels: true,
    concurrentFixes: 3,
    sandboxTimeoutMs: 600_000,
    maxRetries: 4,
    customWebhooks: false,
    prioritySupport: true,
    trialDays: 14,
    trialFixLimit: 5,
  },
  team: {
    id: 'team',
    name: 'Team',
    description: 'For teams — higher limits, priority support',
    amountCents: 14900,
    priceId: getPlanPriceId('team'),
    monthlyFixLimit: 500,
    premiumModels: true,
    concurrentFixes: 10,
    sandboxTimeoutMs: 900_000,
    maxRetries: 10,
    customWebhooks: true,
    prioritySupport: true,
    trialDays: 14,
    trialFixLimit: 5,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited fixes, custom terms, dedicated support',
    amountCents: 0,
    priceId: '',
    monthlyFixLimit: 999_999,
    premiumModels: true,
    concurrentFixes: 50,
    sandboxTimeoutMs: 1_800_000,
    maxRetries: 10,
    customWebhooks: true,
    prioritySupport: true,
    trialDays: 0,
    trialFixLimit: 999_999,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a plan by its Stripe Price ID.
 * Returns undefined if no plan matches.
 */
export function getPlanByPriceId(priceId: string): Plan | undefined {
  for (const plan of Object.values(PLANS)) {
    if (plan.priceId === priceId) {
      return plan;
    }
  }
  return undefined;
}

/**
 * Look up a plan by its ID.
 */
export function getPlan(planId: PlanId): Plan {
  return PLANS[planId];
}

/**
 * Get the monthly fix limit for a plan.
 */
export function getMonthlyFixLimit(planId: PlanId): number {
  return PLANS[planId].monthlyFixLimit;
}

/**
 * Map a plan ID to a tier string (used in the rate limiter / pricing modules).
 */
export function planIdToTier(planId: PlanId): 'free' | 'pro' | 'team' | 'enterprise' | 'self-hosted' {
  switch (planId) {
    case 'selfHosted':
      return 'self-hosted';
    case 'free':
      return 'free';
    case 'solo':
      return 'pro';
    case 'team':
      return 'team';
    case 'enterprise':
      return 'enterprise';
  }
}
