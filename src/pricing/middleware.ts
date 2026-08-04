/**
 * Express middleware for tier-based quota enforcement.
 *
 * Wraps route handlers that consume fixes (webhook endpoints, queue enqueue
 * paths) and rejects requests that exceed the account's monthly fix quota.
 *
 * ── Headers ─────────────────────────────────────────────────────────────────
 * Every response includes quota visibility headers so callers can inspect
 * their current tier and remaining capacity:
 *
 *   X-Tier              – current tier name ("free", "pro", "enterprise")
 *   X-RateLimit-Remaining – remaining fixes in the current month
 *   X-RateLimit-Reset     – Unix timestamp (ms) when the quota resets
 *   X-RateLimit-Limit     – total monthly quota for the tier
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ Redis failures degrade gracefully: the request is allowed through and all
 *    rate-limit headers are set to conservative defaults.
 * ✅ The middleware never throws — errors are caught and the request continues.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { NextFunction, Request, Response } from 'express';
import type { Tier } from '../ratelimit/tiers.js';
import { getTierForAccount } from '../ratelimit/tiers.js';
import { getFeatureGate } from './tiers.js';
import { getMonthlyUsage } from './quota.js';
import { applyBalanceAfterLimit } from '../usage-limits/enforcement.js'; // AIM-4645
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pricing-middleware' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuotaCheckOptions {
  /** How to extract the account/installation ID from the request. */
  getAccountId: (req: Request) => number;
  /** Whether to skip quota enforcement (e.g. for admin routes). Default: false. */
  bypass?: (req: Request) => boolean;
}

// ---------------------------------------------------------------------------
// Default account-ID extractor
// ---------------------------------------------------------------------------

/**
 * Default account-ID extractor: reads `installationId` from the request body.
 * This works for most webhook payloads that include the installation ID.
 */
export function defaultGetAccountId(req: Request): number {
  return req.body?.installation?.id ?? req.body?.installationId ?? 0;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create Express middleware that enforces monthly quota limits for the
 * requesting account.
 *
 * Usage:
 *   ```ts
 *   import { quotaMiddleware } from './pricing/middleware.js';
 *
 *   app.post('/webhook', quotaMiddleware(), handleWebhook);
 *   ```
 *
 * The middleware:
 *   1. Resolves the account (installation) ID from the request
 *   2. Looks up the tier for that account
 *   3. Fetches current monthly usage from Redis
 *   4. If over quota: responds 402 with upgrade CTA + quota headers
 *   5. If under quota: calls next() with quota headers set on the response
 */
export function quotaMiddleware(options?: Partial<QuotaCheckOptions>) {
  const getAccountId = options?.getAccountId ?? defaultGetAccountId;
  const bypass = options?.bypass;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Allow bypass (e.g. health checks, admin endpoints)
    if (bypass?.(req)) {
      next();
      return;
    }

    const accountId = getAccountId(req);

    if (accountId <= 0) {
      // No identifiable account — pass through without enforcement
      log.warn({ path: req.path }, 'No account ID found for quota check — allowing request');
      next();
      return;
    }

    try {
      const tier: Tier = getTierForAccount(accountId);
      const features = getFeatureGate(tier);
      const currentUsage = await getMonthlyUsage(accountId);
      const remaining = Math.max(0, features.monthlyFixQuota - currentUsage);

      // Set quota visibility headers
      res.setHeader('X-Tier', tier);
      res.setHeader('X-RateLimit-Limit', String(features.monthlyFixQuota));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(getNextMonthStartMs()));

      if (remaining <= 0 && features.monthlyFixQuota < 999_999) {
        // AIM-4645: when the account opts in, consume balance instead of blocking
        const override = await applyBalanceAfterLimit(accountId);
        if (override.allowed) {
          log.info(
            { accountId, tier, consumedCredits: override.consumedCredits, remainingBalance: override.remainingBalance },
            'Balance-after-limits override allowed fix run past monthly quota',
          );
          next();
          return;
        }

        log.warn(
          { accountId, tier, usage: currentUsage, quota: features.monthlyFixQuota },
          'Monthly quota exhausted — rejecting request',
        );

        res.status(402).json({
          error: 'Monthly fix quota exhausted',
          message: `Your ${tier} plan allows ${features.monthlyFixQuota} fixes per month. ` +
            `You have used ${currentUsage}. Upgrade to Pro or Enterprise for higher limits.`,
          tier,
          usage: currentUsage,
          limit: features.monthlyFixQuota,
          remaining: 0,
          reset: getNextMonthStartMs(),
          upgradeUrl: 'https://syntaro.ai/pricing',
        });

        return;
      }

      next();
    } catch (err) {
      log.error(
        { err: String(err), accountId, path: req.path },
        'Quota middleware error — allowing request through',
      );
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the Unix timestamp (ms) for the start of the next UTC month.
 */
function getNextMonthStartMs(): number {
  const now = new Date();
  // Start of next month
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return nextMonth.getTime();
}
