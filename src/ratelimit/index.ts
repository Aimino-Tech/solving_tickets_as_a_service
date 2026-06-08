/**
 * Rate limiting and concurrency control module.
 *
 * Combines:
 *   - Redis-backed sliding window rate limiter (per-account, per-repo, per-IP)
 *   - Tier-aware limits (Free / Pro / Enterprise)
 *   - Per-account concurrency manager
 *   - Express middleware for enforcing limits and adding headers
 *   - Centralized, config-driven rate limit tiers for all route groups
 *   - Prometheus metrics for rate limit hits/blocks
 *
 * Usage:
 *   ```ts
 *   import { rateLimiter, concurrencyManager, rateLimitMiddleware } from './ratelimit/index.js';
 *
 *   // In server setup:
 *   app.use('/webhook', rateLimitMiddleware());
 *
 *   // In worker:
 *   const result = await concurrencyManager.acquire(installationId, jobId);
 *   ```
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * All components fail-open on Redis errors — requests are allowed through,
 * concurrent runs proceed, and errors are logged.
 * ────────────────────────────────────────────────────────────────────────────
 */

export { RateLimiter, rateLimiter, getRedisClient, closeRedisClient } from './limiter.js';
export type { RateLimitResult, RateLimitScope, RateLimiterOptions } from './limiter.js';

export {
  getTierForAccount,
  getTierConfigForAccount,
  getRateLimitForAccount,
  getConcurrencyLimitForAccount,
  setTierOverride,
  clearTierOverride,
  initTierOverrides,
} from './tiers.js';
export type { Tier, TierConfig } from './tiers.js';
export { TIER_CONFIGS, TIER_ORDER } from './tiers.js';

export {
  ConcurrencyManager,
  concurrencyManager,
  DEFAULT_CONCURRENCY_TIMEOUT_S,
} from './concurrency.js';
export type { ConcurrencyResult, ConcurrencyManagerOptions } from './concurrency.js';

export {
  rateLimitMiddleware,
  addRateLimitHeaders,
  createRateLimiter,
} from './middleware.js';
export type { RateLimitMiddlewareOptions } from './middleware.js';

export { DEFAULT_RATE_LIMIT_TIERS, TIER_DEFAULTS } from './config.js';
export type { RateLimitTierConfig, RateLimitTierName } from './config.js';

export {
  recordRateLimitDecision,
  recordRateLimitBlock,
  recordRateLimitAllow,
  renderRateLimitMetrics,
  resetRateLimitMetrics,
} from './metrics.js';
