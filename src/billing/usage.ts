/**
 * Usage tracking per billing period.
 *
 * Tracks the number of fix runs consumed per account per billing period.
 * Uses Redis sorted sets (same mechanism as src/pricing/quota.ts) but
 * scoped to the billing period (which may differ from calendar month for
 * paid accounts).
 *
 * Key format: `syntaro:billing:usage:{accountId}:{periodKey}`
 *   - accountId:   Internal SYNTARO account ID
 *   - periodKey:   Billing period identifier (YYYY-MM or Stripe subscription ID)
 *
 * ── Error Handling ────────────────────────────────────────────────────────────
 * ✅ All Redis failures are caught, logged, and return safe defaults (0 usage)
 * ✅ The system remains operational even if Redis is temporarily unavailable
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { PlanId } from './plans.js';
import { getMonthlyFixLimit } from './plans.js';

const log = rootLogger.child({ module: 'billing-usage' });

// ---------------------------------------------------------------------------
// Shared Redis client
// ---------------------------------------------------------------------------

let usageRedis: Redis | null = null;

/**
 * Get (or create) the shared Redis client for billing usage tracking.
 */
export function getUsageRedisClient(): Redis {
  if (!usageRedis) {
    usageRedis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      lazyConnect: true,
    });

    usageRedis.on('error', (err) => {
      log.error({ err: String(err) }, 'Billing usage Redis connection error');
    });
  }
  return usageRedis;
}

/**
 * Close the shared billing usage Redis client.
 */
export async function closeUsageRedisClient(): Promise<void> {
  if (usageRedis) {
    try {
      await usageRedis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing billing usage Redis client');
    }
    usageRedis = null;
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Build a Redis key for tracking billing usage.
 *
 * Uses the billing period start timestamp if available, otherwise falls back
 * to the current calendar month.
 */
export function buildUsageKey(
  accountId: number,
  periodStart?: Date,
): string {
  if (periodStart) {
    const year = periodStart.getUTCFullYear();
    const month = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
    return `syntaro:billing:usage:${accountId}:${year}-${month}`;
  }
  // Fall back to current calendar month
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `syntaro:billing:usage:${accountId}:${year}-${month}`;
}

// ---------------------------------------------------------------------------
// Usage operations
// ---------------------------------------------------------------------------

/**
 * Get the number of fixes consumed in the current billing period.
 */
export async function getBillingUsage(
  accountId: number,
  periodStart?: Date,
): Promise<number> {
  try {
    const client = getUsageRedisClient();
    const key = buildUsageKey(accountId, periodStart);
    const now = Date.now();
    const periodBegin = periodStart
      ? periodStart.getTime()
      : getMonthStartMs();

    return await client.zcount(key, periodBegin, now);
  } catch (err) {
    log.error(
      { err: String(err), accountId },
      'Failed to get billing usage — returning 0',
    );
    return 0;
  }
}

/**
 * Get the remaining fixes for the current billing period.
 */
export async function getRemainingBillingUsage(
  accountId: number,
  planId: PlanId,
  periodStart?: Date,
): Promise<number> {
  try {
    const limit = getMonthlyFixLimit(planId);
    // Enterprise/unlimited
    if (limit >= 999_999) {
      return limit;
    }

    const usage = await getBillingUsage(accountId, periodStart);
    return Math.max(0, limit - usage);
  } catch (err) {
    log.error(
      { err: String(err), accountId, planId },
      'Failed to get remaining billing usage — returning 0',
    );
    return 0;
  }
}

/**
 * Check if the account has exceeded their billing plan's fix limit.
 * Returns true if usage >= limit (i.e., the account is blocked).
 */
export async function hasExceededUsageLimit(
  accountId: number,
  planId: PlanId,
  periodStart?: Date,
): Promise<boolean> {
  try {
    const limit = getMonthlyFixLimit(planId);
    if (limit >= 999_999) return false; // Enterprise/unlimited

    const usage = await getBillingUsage(accountId, periodStart);
    return usage >= limit;
  } catch (err) {
    log.error(
      { err: String(err), accountId, planId },
      'Failed to check usage limit — allowing request through',
    );
    return false;
  }
}

/**
 * Check if usage is at or above a given percentage threshold.
 * Used for warning emails (e.g., 80% of limit).
 */
export async function isUsageAtThreshold(
  accountId: number,
  planId: PlanId,
  thresholdPercent: number,
  periodStart?: Date,
): Promise<boolean> {
  try {
    const limit = getMonthlyFixLimit(planId);
    if (limit >= 999_999) return false;

    const usage = await getBillingUsage(accountId, periodStart);
    return usage >= Math.ceil(limit * (thresholdPercent / 100));
  } catch (err) {
    log.error(
      { err: String(err), accountId, planId, thresholdPercent },
      'Failed to check usage threshold',
    );
    return false;
  }
}

/**
 * Record a fix execution for billing usage tracking.
 */
export async function incrementBillingUsage(
  accountId: number,
  periodStart?: Date,
): Promise<void> {
  try {
    const client = getUsageRedisClient();
    const key = buildUsageKey(accountId, periodStart);
    const now = Date.now();
    const member = `${now}:${crypto.randomUUID()}`;

    const pipeline = client.pipeline();
    pipeline.zadd(key, now, member);
    // TTL of 32 days to auto-evict stale keys
    pipeline.expire(key, 32 * 24 * 60 * 60);
    await pipeline.exec();

    log.debug({ accountId, key }, 'Billing usage incremented');
  } catch (err) {
    log.error(
      { err: String(err), accountId },
      'Failed to increment billing usage',
    );
  }
}

/**
 * Reset billing usage for an account.
 */
export async function resetBillingUsage(
  accountId: number,
  periodStart?: Date,
): Promise<void> {
  try {
    const client = getUsageRedisClient();
    const key = buildUsageKey(accountId, periodStart);
    await client.del(key);
    log.info({ accountId, key }, 'Billing usage reset');
  } catch (err) {
    log.error(
      { err: String(err), accountId },
      'Failed to reset billing usage',
    );
  }
}

// ---------------------------------------------------------------------------
// Usage check middleware integration
// ---------------------------------------------------------------------------

/**
 * Result of a usage check before running a fix.
 */
export interface UsageCheckResult {
  /** Whether the fix is allowed to proceed. */
  allowed: boolean;
  /** Current usage count. */
  usage: number;
  /** Plan's fix limit. */
  limit: number;
  /** Remaining fixes. */
  remaining: number;
  /** Error message if blocked. */
  error?: string;
}

/**
 * Check if an account can run a fix based on their billing plan usage.
 * This is called before enqueuing a fix job.
 */
export async function checkUsageBeforeFix(
  accountId: number,
  planId: PlanId,
  periodStart?: Date,
): Promise<UsageCheckResult> {
  const limit = getMonthlyFixLimit(planId);

  try {
    const usage = await getBillingUsage(accountId, periodStart);
    const remaining = Math.max(0, limit - usage);

    if (usage >= limit && limit < 999_999) {
      return {
        allowed: false,
        usage,
        limit,
        remaining: 0,
        error: `Monthly fix limit of ${limit} reached. Upgrade your plan for higher limits.`,
      };
    }

    return {
      allowed: true,
      usage,
      limit,
      remaining,
    };
  } catch (err) {
    log.error(
      { err: String(err), accountId, planId },
      'Error checking usage before fix — allowing fix to proceed',
    );
    return {
      allowed: true,
      usage: 0,
      limit,
      remaining: limit,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get the Unix timestamp (ms) for the start of the current UTC month.
 */
function getMonthStartMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}
