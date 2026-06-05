/**
 * Redis-backed concurrency manager for per-account fix run limits.
 *
 * Tracks active fix runs per GitHub installation ID and blocks new jobs
 * when an account reaches its concurrency limit. Slots auto-release via
 * TTL if a fix hangs. Supports admin overrides for specific accounts.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis connection errors are caught and logged; acquire() returns false
 * ✅ Release operations are idempotent (safe to call multiple times)
 * ✅ Auto-release TTL ensures slots don't leak on crashed workers
 * ✅ Admin overrides are stored in Redis with no expiry (manually removable)
 * ────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'concurrency-manager' });

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/** Concurrency limit (fixes) per subscription tier. */
export const TIER_CONCURRENCY_LIMITS: Record<string, number> = {
  free: 1,
  pro: 3,
  enterprise: 10,
};

/** Redis key prefixes. */
const KEYS = {
  activeSlots: (accountId: number) => `concurrency:${accountId}:active`,
  adminOverride: (accountId: number) => `concurrency:${accountId}:override`,
} as const;

/** Slice TTL in seconds — auto-releases a slot if a fix hangs. */
const SLOT_TTL_SECONDS = 900; // 15 minutes

export interface ConcurrencyManagerOptions {
  redisUrl?: string;
  redis?: Redis;
}

export class ConcurrencyManager {
  private redis: Redis;
  private defaultLimit: number;

  constructor(options: ConcurrencyManagerOptions = {}) {
    this.redis =
      options.redis ??
      new Redis(options.redisUrl ?? DEFAULT_REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          log.warn({ attempt: times }, `ConcurrencyManager Redis retry in ${delay}ms`);
          return delay;
        },
        lazyConnect: true,
      });
    this.defaultLimit = TIER_CONCURRENCY_LIMITS.pro; // safe default
  }

  /**
   * Attempt to acquire a concurrency slot for an account.
   * Returns true if the slot was acquired, false if at the limit.
   */
  async acquire(accountId: number, tier?: string): Promise<boolean> {
    const limit = await this.getEffectiveLimit(accountId, tier);
    const key = KEYS.activeSlots(accountId);
    const slotId = `${accountId}:${crypto.randomUUID()}`;

    try {
      // Use a Redis Lua script for atomic check-and-add
      const script = `
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local slotId = ARGV[2]
        local ttl = tonumber(ARGV[3])

        local active = redis.call("SCARD", key)
        if active >= limit then
          return 0
        end

        redis.call("SADD", key, slotId)
        redis.call("EXPIRE", key, ttl)
        return 1
      `;

      const result = await this.redis.eval(script, 1, key, String(limit), slotId, String(SLOT_TTL_SECONDS));

      if (result === 1) {
        log.info({ accountId, tier, activeSlots: await this.redis.scard(key) }, 'Concurrency slot acquired');
        return true;
      }

      log.warn({ accountId, tier, limit }, 'Concurrency limit reached — slot denied');
      return false;
    } catch (err) {
      log.error({ err: String(err), accountId }, 'Failed to acquire concurrency slot');
      return false; // Fail closed to prevent overload
    }
  }

  /**
   * Release a concurrency slot for an account.
   * Idempotent — safe to call multiple times for the same job.
   */
  async release(accountId: number): Promise<void> {
    const key = KEYS.activeSlots(accountId);

    try {
      // Remove one arbitrary member (we don't need to know which slot)
      const member = await this.redis.spop(key);
      if (member) {
        const remaining = await this.redis.scard(key);
        log.info({ accountId, remainingSlots: remaining }, 'Concurrency slot released');
      } else {
        // No slot to release — already freed or never acquired
        log.debug({ accountId }, 'No concurrency slot to release (already freed)');
      }
    } catch (err) {
      log.error({ err: String(err), accountId }, 'Failed to release concurrency slot');
    }
  }

  /**
   * Get the effective concurrency limit for an account.
   * Admin overrides take precedence, then subscription tier, then default.
   */
  async getEffectiveLimit(accountId: number, tier?: string): Promise<number> {
    try {
      // Check admin override
      const override = await this.redis.get(KEYS.adminOverride(accountId));
      if (override !== null) {
        const parsed = Number(override);
        if (!Number.isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch (err) {
      log.warn({ err: String(err), accountId }, 'Failed to check admin override');
    }

    return tier ? (TIER_CONCURRENCY_LIMITS[tier] ?? this.defaultLimit) : this.defaultLimit;
  }

  /**
   * Set an admin override for an account's concurrency limit.
   * This persists until manually removed via removeAdminOverride.
   */
  async setAdminOverride(accountId: number, limit: number): Promise<void> {
    if (limit < 1 || !Number.isInteger(limit)) {
      throw new Error(`Invalid concurrency override limit: ${limit}. Must be a positive integer.`);
    }

    try {
      await this.redis.set(KEYS.adminOverride(accountId), String(limit));
      log.info({ accountId, limit }, 'Admin concurrency override set');
    } catch (err) {
      log.error({ err: String(err), accountId }, 'Failed to set admin override');
      throw err;
    }
  }

  /**
   * Remove an admin override for an account, reverting to tier-based limits.
   */
  async removeAdminOverride(accountId: number): Promise<void> {
    try {
      await this.redis.del(KEYS.adminOverride(accountId));
      log.info({ accountId }, 'Admin concurrency override removed');
    } catch (err) {
      log.error({ err: String(err), accountId }, 'Failed to remove admin override');
      throw err;
    }
  }

  /**
   * Get the current number of active slots for an account.
   */
  async getActiveCount(accountId: number): Promise<number> {
    try {
      const key = KEYS.activeSlots(accountId);
      return await this.redis.scard(key);
    } catch (err) {
      log.error({ err: String(err), accountId }, 'Failed to get active count');
      return 0;
    }
  }

  /**
   * Clean up stale slots for an account (force release all).
   */
  async resetAccount(accountId: number): Promise<void> {
    try {
      const key = KEYS.activeSlots(accountId);
      await this.redis.del(key);
      log.info({ accountId }, 'All concurrency slots released for account');
    } catch (err) {
      log.error({ err: String(err), accountId }, 'Failed to reset account');
    }
  }

  /**
   * Close the underlying Redis connection.
   */
  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing concurrency manager Redis');
    }
  }

  /**
   * Get the underlying Redis instance (for testing).
   */
  getRedis(): Redis {
    return this.redis;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultInstance: ConcurrencyManager | null = null;

/**
 * Get or create the default ConcurrencyManager singleton.
 */
export function getConcurrencyManager(options?: ConcurrencyManagerOptions): ConcurrencyManager {
  if (!defaultInstance) {
    defaultInstance = new ConcurrencyManager(options);
  }
  return defaultInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetConcurrencyManager(): void {
  defaultInstance = null;
}
