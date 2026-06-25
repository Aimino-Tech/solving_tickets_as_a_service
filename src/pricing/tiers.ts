/**
 * Feature-gate definitions for STAS pricing tiers.
 *
 * Builds on the tier system in src/ratelimit/tiers.ts by adding per-tier
 * feature gates that control access to premium functionality. Every account
 * maps to one of Free, Pro, or Enterprise tiers.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * Feature gates are consumed by:
 *   - src/pricing/quota.ts   — monthly fix quota enforcement
 *   - src/pricing/middleware.ts — Express middleware that rejects over-quota
 *   - src/queue/issueQueue.ts   — pre-enqueue quota & concurrency checks
 *
 * Tiers and their feature sets are static in the MVP. A future iteration may
 * migrate to a database-backed config or allow admin-level overrides per account.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { Tier } from '../ratelimit/tiers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Feature gate configuration for a single tier.
 * Each boolean field enables/disables a premium feature; numeric fields cap usage.
 */
export interface FeatureGate {
  /** Maximum concurrent fix runs allowed. */
  concurrentFixes: number;
  /** Maximum fixes per billing month (0 = unlimited, 999999 = effectively unlimited). */
  monthlyFixQuota: number;
  /** Whether the tier can use premium models (Sonnet, GPT-4 class). */
  premiumModels: boolean;
  /** Maximum retry attempts for a fix job. */
  maxRetries: number;
  /** Maximum execution time in ms for a sandboxed code run. */
  sandboxTimeoutMs: number;
  /** Whether the tier can configure custom webhook endpoints. */
  customWebhooks: boolean;
  /** Whether the tier gets priority support / issue triage. */
  prioritySupport: boolean;
}

// ---------------------------------------------------------------------------
// Tier feature definitions
// ---------------------------------------------------------------------------

/**
 * Feature gate configuration for every tier.
 *
 * Free  – single concurrent fix, 10 fixes/month, no premium models
 * Pro   – 3 concurrent fixes, 100 fixes/month, premium models, priority support
 * Enterprise – 10 concurrent fixes, unlimited fixes, all features
 */
export const TIER_FEATURES: Record<Tier, FeatureGate> = {
  free: {
    concurrentFixes: 1,
    monthlyFixQuota: 10,
    premiumModels: false,
    maxRetries: 2,
    sandboxTimeoutMs: 300_000,
    customWebhooks: false,
    prioritySupport: false,
  },
  pro: {
    concurrentFixes: 3,
    monthlyFixQuota: 100,
    premiumModels: true,
    maxRetries: 4,
    sandboxTimeoutMs: 600_000,
    customWebhooks: false,
    prioritySupport: true,
  },
  team: {
    concurrentFixes: 10,
    monthlyFixQuota: 500,
    premiumModels: true,
    maxRetries: 10,
    sandboxTimeoutMs: 900_000,
    customWebhooks: true,
    prioritySupport: true,
  },
  enterprise: {
    concurrentFixes: 50,
    monthlyFixQuota: 999_999,
    premiumModels: true,
    maxRetries: 10,
    sandboxTimeoutMs: 1_800_000,
    customWebhooks: true,
    prioritySupport: true,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the feature gate config for a given tier.
 * Shortcut for `TIER_FEATURES[tier]`.
 */
export function getFeatureGate(tier: Tier): FeatureGate {
  return TIER_FEATURES[tier];
}

/**
 * Check whether a tier has access to premium models.
 */
export function canUsePremiumModels(tier: Tier): boolean {
  return TIER_FEATURES[tier].premiumModels;
}

/**
 * Get the monthly fix quota for a given tier.
 */
export function getMonthlyQuota(tier: Tier): number {
  return TIER_FEATURES[tier].monthlyFixQuota;
}

/**
 * Get the maximum concurrent fixes for a given tier.
 */
export function getConcurrentFixesLimit(tier: Tier): number {
  return TIER_FEATURES[tier].concurrentFixes;
}

/**
 * Get the maximum number of retries for a given tier.
 */
export function getMaxRetries(tier: Tier): number {
  return TIER_FEATURES[tier].maxRetries;
}

/**
 * Get the sandbox timeout in milliseconds for a given tier.
 */
export function getSandboxTimeoutMs(tier: Tier): number {
  return TIER_FEATURES[tier].sandboxTimeoutMs;
}
