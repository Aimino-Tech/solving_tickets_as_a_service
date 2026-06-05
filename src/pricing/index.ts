/**
 * Pricing module — tier definitions, quota management, and feature gating.
 *
 * This is the public API for the pricing subsystem. Import from here rather
 * than from individual modules.
 *
 * Usage:
 *   ```ts
 *   import { getFeatureGate, getRemainingQuota, quotaMiddleware } from './pricing/index.js';
 *   ```
 *
 * @module pricing
 */

export {
  TIER_FEATURES,
  getFeatureGate,
  canUsePremiumModels,
  getMonthlyQuota,
  getConcurrentFixesLimit,
  getMaxRetries,
  getSandboxTimeoutMs,
} from './tiers.js';

export type { FeatureGate } from './tiers.js';

export {
  getMonthlyUsage,
  getRemainingQuota,
  incrementUsage,
  resetAccountQuota,
  resetMonthlyQuotas,
  getGlobalMonthlyUsage,
  closeQuotaRedisClient,
} from './quota.js';

export {
  quotaMiddleware,
  defaultGetAccountId,
} from './middleware.js';

export type { QuotaCheckOptions } from './middleware.js';

export { adminRouter } from './admin.js';
