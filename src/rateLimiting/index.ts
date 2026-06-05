/**
 * Rate limiting and concurrency control module.
 *
 * Provides Redis-backed rate limiting across multiple layers (IP, account, repo)
 * and per-account concurrency control for fix runs, with limits varying by
 * subscription tier.
 *
 * Usage:
 *   import { createRateLimitMiddleware } from './rateLimiting/index.js';
 *   app.use('/webhook', createRateLimitMiddleware());
 */

export { ConcurrencyManager, getConcurrencyManager, resetConcurrencyManager, TIER_CONCURRENCY_LIMITS } from './concurrencyManager.js';
export type { ConcurrencyManagerOptions } from './concurrencyManager.js';

export { RedisRateLimiter, getRateLimiter, resetRateLimiter } from './redisRateLimiter.js';
export type { RateLimitResult, RateLimiterOptions } from './redisRateLimiter.js';

export { createRateLimitMiddleware } from './rateLimitMiddleware.js';
export type { TierLimits, RateLimitMiddlewareOptions } from './rateLimitMiddleware.js';
export { TIER_LIMITS } from './rateLimitMiddleware.js';

export {
  rateLimitBlocked,
  rateLimitAllowed,
  concurrencyAcquired,
  concurrencyReleased,
  concurrencyDenied,
  concurrencyActive,
  logMetrics,
  resetAllMetrics,
} from './metrics.js';
export type { Counter } from './metrics.js';
