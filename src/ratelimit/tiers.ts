/**
 * Tier-aware rate limit and concurrency configuration.
 *
 * Defines the three subscription tiers (Free, Pro, Enterprise) with their
 * associated rate limits and concurrency caps. The default tier is Free.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * Tiers are determined by GitHub Marketplace plan names mapped to installation
 * IDs. In the MVP, this uses a simple in-memory map that can be replaced with
 * a database-backed lookup in a future iteration.
 *
 * Admin overrides for individual accounts (e.g. beta testers, internal use)
 * are supported via an environment variable or Redis-backed override set.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-tiers' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tier = 'free' | 'pro' | 'enterprise';

export interface TierConfig {
  /** Human-readable label. */
  label: string;
  /** Maximum webhook requests per sliding window (per account). */
  requestsPerWindow: number;
  /** Maximum concurrent fix runs (per account). */
  maxConcurrency: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  free: {
    label: 'Free',
    requestsPerWindow: 10,
    maxConcurrency: 1,
    windowMs: 60_000,
  },
  pro: {
    label: 'Pro',
    requestsPerWindow: 60,
    maxConcurrency: 3,
    windowMs: 60_000,
  },
  enterprise: {
    label: 'Enterprise',
    requestsPerWindow: 300,
    maxConcurrency: 10,
    windowMs: 60_000,
  },
};

/**
 * Ordered list of tiers from most restrictive to least restrictive.
 */
export const TIER_ORDER: Tier[] = ['free', 'pro', 'enterprise'];

// ---------------------------------------------------------------------------
// Tier assignment
// ---------------------------------------------------------------------------

/**
 * In-memory tier overrides for specific installation IDs.
 * Key = installation ID (number), Value = tier name.
 *
 * Populated from the STAS_TIER_OVERRIDES env var.
 * Format: comma-separated "installationId:tier" pairs
 *   Example: "12345:pro,67890:enterprise"
 */
let tierOverrides: Map<number, Tier> = new Map();

/**
 * Initialize tier overrides from the environment.
 * Called once at startup.
 */
export function initTierOverrides(): void {
  const raw = process.env.STAS_TIER_OVERRIDES;
  if (!raw) return;

  const map = new Map<number, Tier>();
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [idStr, tierStr] = trimmed.split(':');
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      log.warn({ pair: trimmed }, 'Invalid installation ID in STAS_TIER_OVERRIDES');
      continue;
    }
    const tier = tierStr?.trim().toLowerCase() as Tier;
    if (!TIER_CONFIGS[tier]) {
      log.warn({ pair: trimmed, tier }, 'Invalid tier in STAS_TIER_OVERRIDES');
      continue;
    }
    map.set(id, tier);
  }

  tierOverrides = map;

  if (map.size > 0) {
    log.info({ overrides: Object.fromEntries(map) }, 'Tier overrides initialized');
  }
}

/**
 * Get the tier for a given GitHub installation (account) ID.
 *
 * Resolution order:
 *  1. Admin override (env var STAS_TIER_OVERRIDES)
 *  2. Default: free
 */
export function getTierForAccount(installationId: number): Tier {
  const override = tierOverrides.get(installationId);
  if (override && TIER_CONFIGS[override]) {
    return override;
  }
  return 'free';
}

/**
 * Get the full tier configuration for a given installation ID.
 */
export function getTierConfigForAccount(installationId: number): TierConfig {
  const tier = getTierForAccount(installationId);
  return TIER_CONFIGS[tier];
}

/**
 * Get rate limit parameters for a given installation ID.
 * Returns { max, windowMs } suitable for passing to RateLimiter.
 */
export function getRateLimitForAccount(installationId: number): { max: number; windowMs: number } {
  const cfg = getTierConfigForAccount(installationId);
  return { max: cfg.requestsPerWindow, windowMs: cfg.windowMs };
}

/**
 * Get concurrency limit for a given installation ID.
 */
export function getConcurrencyLimitForAccount(installationId: number): number {
  const cfg = getTierConfigForAccount(installationId);
  return cfg.maxConcurrency;
}

/**
 * Admin override: set a tier for a specific installation ID at runtime.
 * This is NOT persisted across restarts — use STAS_TIER_OVERRIDES env var
 * for permanent overrides.
 */
export function setTierOverride(installationId: number, tier: Tier): void {
  if (!TIER_CONFIGS[tier]) {
    throw new Error(`Invalid tier: ${tier}`);
  }
  tierOverrides.set(installationId, tier);
  log.info({ installationId, tier }, 'Runtime tier override set');
}

/**
 * Remove a runtime tier override for an installation ID.
 */
export function clearTierOverride(installationId: number): void {
  tierOverrides.delete(installationId);
  log.info({ installationId }, 'Runtime tier override cleared');
}

// ---------------------------------------------------------------------------
// Update config defaults if env vars are set
// ---------------------------------------------------------------------------

/**
 * The effective windowMs for the rate limiter — uses the env-var-configured
 * default if set, otherwise falls through to the Free tier's window.
 */
export const DEFAULT_WINDOW_MS: number = config.stas.rateLimit.windowMs;
