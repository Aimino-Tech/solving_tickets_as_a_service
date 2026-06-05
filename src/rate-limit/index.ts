/**
 * Rate limiting module — credit-based rate limits and per-account concurrency.
 *
 * Features:
 * - Redis-backed sliding-window rate limiter (account, repo, IP)
 * - Tier-based limits (free: 10/min, pro: 60/min, enterprise: 300/min)
 * - Per-account concurrency control with auto-release on timeout
 * - Express middleware with RateLimit-* response headers
 * - Prometheus-compatible metrics counters
 * - Admin override support for concurrency caps
 *
 * Usage:
 * ```ts
 * import { getRateLimiter, getConcurrencyManager } from './rate-limit/index.js';
 *
 * // Rate limit check
 * const result = await getRateLimiter().checkAccount(installationId);
 * if (!result.allowed) {
 *   // Return 429
 * }
 *
 * // Concurrency check
 * const acquired = await getConcurrencyManager().acquire(installationId, jobId);
 * if (!acquired) {
 *   // Return 429 — account at max concurrency
 * }
 * // ... run fix ...
 * await getConcurrencyManager().release(installationId, jobId);
 * ```
 *
 * @module rate-limit
 */

export {
  RateLimiter,
  getRateLimiter,
  resetRateLimiter,
  TIER_LIMITS,
  DEFAULT_TIER,
} from './limiter.js';
export type {
  RateLimitResult,
  TierLimits,
  TierName,
} from './limiter.js';

export {
  ConcurrencyManager,
  getConcurrencyManager,
  resetConcurrencyManager,
} from './concurrency.js';

export {
  rateLimitMiddleware,
} from './middleware.js';

export {
  getMetricsCollector,
  resetMetricsCollector,
} from './metrics.js';
export type {
  RateLimitMetricsSnapshot,
} from './metrics.js';
