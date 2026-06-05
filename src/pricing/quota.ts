/**
 * Monthly fix-quota management backed by Redis sorted sets.
 *
 * Tracks the number of fixes consumed per account per calendar month using
 * Redis sorted sets. Each fix execution appends a member with a Unix-millisecond
 * score, allowing O(log N) count queries within the current month window.
 *
 * Key format: `stas:quotas:{accountId}:{YYYY-MM}`
 *   - accountId: GitHub installation ID
 *   - YYYY-MM:   billing period (e.g. "2026-06")
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ All public methods catch Redis errors, log them, and return safe defaults
 *    (zero usage on read failure, graceful no-op on write failure).
 * ✅ The system remains operational even if Redis is temporarily unavailable —
 *    quota enforcement degrades to "allow" when the store cannot be queried.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import type { Tier } from '../ratelimit/tiers.js';
import { getMonthlyQuota } from './tiers.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pricing-quota' });

// ---------------------------------------------------------------------------
// Shared Redis client (independent from the rate-limiter client)
// ---------------------------------------------------------------------------

let quotaRedis: Redis | null = null;

/**
 * Get (or create) the shared Redis client for quota tracking.
 */
export function getQuotaRedisClient(): Redis {
  if (!quotaRedis) {
    quotaRedis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Quota Redis retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });

    quotaRedis.on('error', (err) => {
      log.error({ err: String(err) }, 'Quota Redis connection error');
    });

    quotaRedis.on('connect', () => {
      log.info('Quota Redis connected');
    });
  }
  return quotaRedis;
}

/**
 * Close the shared quota Redis client.
 */
export async function closeQuotaRedisClient(): Promise<void> {
  if (quotaRedis) {
    try {
      await quotaRedis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing quota Redis client');
    }
    quotaRedis = null;
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Build the Redis key for an account's monthly quota.
 *
 * @example
 *   buildQuotaKey(12345, new Date('2026-06-05'))
 *   // => "stas:quotas:12345:2026-06"
 */
export function buildQuotaKey(accountId: number, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `stas:quotas:${accountId}:${year}-${month}`;
}

// ---------------------------------------------------------------------------
// Quota operations
// ---------------------------------------------------------------------------

/**
 * Get the number of fixes consumed this month for an account.
 *
 * Counts members in the current month's sorted set. Returns 0 if the key
 * does not exist or if Redis is unreachable.
 */
export async function getMonthlyUsage(accountId: number): Promise<number> {
  try {
    const client = getQuotaRedisClient();
    const key = buildQuotaKey(accountId);
    const now = Date.now();
    const monthStart = getMonthStartMs();

    // ZCOUNT returns the number of members with scores in the range
    return await client.zcount(key, monthStart, now);
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to get monthly usage — returning 0');
    return 0;
  }
}

/**
 * Get the remaining quota for an account this month.
 *
 * Returns the tier's monthly quota minus current usage. If the tier has a
 * quota of 999_999 (Enterprise, effectively unlimited), returns that value
 * directly to avoid an unnecessary Redis round-trip.
 */
export async function getRemainingQuota(accountId: number, tier: Tier): Promise<number> {
  const quota = getMonthlyQuota(tier);

  // Enterprise tier is effectively unlimited — skip the Redis read
  if (quota >= 999_999) {
    return quota;
  }

  try {
    const usage = await getMonthlyUsage(accountId);
    return Math.max(0, quota - usage);
  } catch (err) {
    log.error({ err: String(err), accountId, tier }, 'Failed to get remaining quota — returning full quota');
    return quota;
  }
}

/**
 * Record a fix execution for an account.
 *
 * Adds a member to the current month's sorted set with the current timestamp
 * as its score. Sets a TTL of 32 days (a buffer past the month end) so that
 * Redis auto-evicts stale keys.
 *
 * This is a best-effort operation — failures are logged but not propagated,
 * ensuring that a Redis blip does not prevent fix execution.
 */
export async function incrementUsage(accountId: number): Promise<void> {
  try {
    const client = getQuotaRedisClient();
    const key = buildQuotaKey(accountId);
    const now = Date.now();
    const member = `${now}:${crypto.randomUUID()}`;

    const pipeline = client.pipeline();
    pipeline.zadd(key, now, member);
    // TTL of 32 days ensures the key outlives the current month
    pipeline.expire(key, 32 * 24 * 60 * 60);
    await pipeline.exec();

    log.debug({ accountId, key }, 'Quota usage incremented');
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to increment quota usage');
  }
}

/**
 * Reset all quota counters for an account (deletes the current month's key).
 *
 * Useful during testing or when an admin needs to manually unblock an account.
 */
export async function resetAccountQuota(accountId: number): Promise<void> {
  try {
    const client = getQuotaRedisClient();
    const key = buildQuotaKey(accountId);
    await client.del(key);
    log.info({ accountId, key }, 'Account quota reset');
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to reset account quota');
  }
}

/**
 * Reset monthly quotas for all accounts (cron/CLI utility).
 *
 * Scans for all keys matching the `stas:quotas:*` pattern and deletes them.
 * This is called by a scheduled job at the start of each billing period.
 *
 * Uses SCAN (not KEYS) to avoid blocking Redis on large datasets.
 */
export async function resetMonthlyQuotas(): Promise<void> {
  try {
    const client = getQuotaRedisClient();
    let cursor = '0';
    let deletedCount = 0;

    do {
      const result = await client.scan(cursor, 'MATCH', 'stas:quotas:*', 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        await client.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');

    log.info({ deletedCount }, 'Monthly quotas reset for all accounts');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to reset monthly quotas');
  }
}

/**
 * Get the number of fixes consumed this month across ALL accounts.
 * Useful for dashboard / admin metrics.
 */
export async function getGlobalMonthlyUsage(): Promise<number> {
  try {
    const client = getQuotaRedisClient();
    let cursor = '0';
    let total = 0;

    do {
      const result = await client.scan(cursor, 'MATCH', 'stas:quotas:*', 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        const count = await client.zcard(key);
        total += count;
      }
    } while (cursor !== '0');

    return total;
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get global monthly usage');
    return 0;
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
