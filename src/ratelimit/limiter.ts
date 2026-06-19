/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses Redis sorted sets to track request timestamps per scope+key pair,
 * enabling sliding windows with sub-second precision.
 *
 * Key format: `ratelimit:{scope}:{key}`
 *   - scope: "account" | "repo" | "ip"
 *   - key:   unique identifier within that scope (e.g. installation ID, repo name, IP)
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ Redis failures are caught and logged — request is allowed through (fail-open)
 * ✅ All public methods return a RateLimitResult, never throw
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-limiter' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitScope = 'account' | 'repo' | 'ip';

export interface RateLimitResult {
  /** Whether the request is allowed (within limits). */
  allowed: boolean;
  /** Current request count in the window. */
  current: number;
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Remaining requests in the window. */
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  reset: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Scope this limit applies to. */
  scope: RateLimitScope;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

// ---------------------------------------------------------------------------
// Shared Redis client
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;

/**
 * Get (or create) the shared Redis client for rate limiting.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Rate limiter Redis retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });

    redisClient.on('error', (err) => {
      log.error({ err: String(err) }, 'Rate limiter Redis connection error');
    });

    redisClient.on('connect', () => {
      log.info('Rate limiter Redis connected');
    });
  }
  return redisClient;
}

/**
 * Close the shared Redis client. Used during graceful shutdown.
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing rate limiter Redis client');
    }
    redisClient = null;
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

/**
 * Sliding window rate limiter backed by Redis sorted sets.
 *
 * Algorithm:
 *  1. ZADD the current timestamp as a member with score = timestamp
 *  2. ZREMRANGEBYSCORE to remove entries older than the window
 *  3. ZCOUNT to count remaining entries in the window
 *  4. Compare count against max
 *
 * The member is `{timestamp}:{random}` to guarantee uniqueness within a
 * single-millisecond collision window.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;

  constructor(options?: Partial<RateLimiterOptions>) {
    this.windowMs = options?.windowMs ?? config.stas.rateLimit.windowMs;
    this.max = options?.max ?? config.stas.rateLimit.max;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Check if a request is allowed for the given scope:key pair.
   * Does NOT increment the counter — use increment() to record the request.
   *
   * This is useful for read-only checks (e.g. middleware wanting to inspect
   * limits without recording).
   */
  async checkLimit(scope: RateLimitScope, key: string): Promise<RateLimitResult> {
    try {
      const redisKey = this.buildKey(scope, key);
      const client = getRedisClient();
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Clean old entries and count current ones in a single pipeline
      const pipeline = client.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zcount(redisKey, windowStart, now);
      const results = await pipeline.exec();

      const count = this.extractCount(results);
      const oldestTimestamp = await this.getOldestTimestamp(redisKey, client);

      return this.buildResult(scope, count, oldestTimestamp, now);
    } catch (err) {
      log.error({ err: String(err), scope, key }, 'Rate limit check failed — allowing request');
      return this.failOpenResult(scope);
    }
  }

  /**
   * Increment the counter and return the new state.
   * Call this when a request is actually processed.
   */
  async increment(scope: RateLimitScope, key: string): Promise<RateLimitResult> {
    try {
      const redisKey = this.buildKey(scope, key);
      const client = getRedisClient();
      const now = Date.now();
      const windowStart = now - this.windowMs;
      const member = `${now}:${crypto.randomUUID()}`;

      // Add entry, clean old entries, count current — all in one pipeline
      const pipeline = client.pipeline();
      pipeline.zadd(redisKey, now, member);
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zcount(redisKey, windowStart, now);
      pipeline.expire(redisKey, Math.ceil(this.windowMs / 1000) + 1);
      const results = await pipeline.exec();

      const count = this.extractCount(results, 2);
      const oldestTimestamp = now;

      return this.buildResult(scope, count, oldestTimestamp, now);
    } catch (err) {
      log.error({ err: String(err), scope, key }, 'Rate limit increment failed — allowing request');
      return this.failOpenResult(scope);
    }
  }

  /**
   * Reset the rate limit counter for the given scope:key.
   * Deletes the entire sorted set.
   */
  async reset(scope: RateLimitScope, key: string): Promise<void> {
    try {
      const redisKey = this.buildKey(scope, key);
      const client = getRedisClient();
      await client.del(redisKey);
    } catch (err) {
      log.error({ err: String(err), scope, key }, 'Rate limit reset failed');
    }
  }

  /**
   * Get current count without modifying state.
   */
  async getCurrentCount(scope: RateLimitScope, key: string): Promise<number> {
    try {
      const redisKey = this.buildKey(scope, key);
      const client = getRedisClient();
      const now = Date.now();
      const windowStart = now - this.windowMs;

      const pipeline = client.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zcount(redisKey, windowStart, now);
      const results = await pipeline.exec();

      return this.extractCount(results);
    } catch (err) {
      log.error({ err: String(err), scope, key }, 'Rate limit getCurrentCount failed');
      return 0;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private buildKey(scope: RateLimitScope, key: string): string {
    return `ratelimit:${scope}:${key}`;
  }

  private extractCount(results: [Error | null, unknown][] | null, resultIndex = 1): number {
    if (!results || !results[resultIndex]) {
      return 0;
    }
    const [, value] = results[resultIndex];
    if (typeof value === 'number') {
      return value;
    }
    return 0;
  }

  private async getOldestTimestamp(redisKey: string, client: Redis): Promise<number> {
    try {
      // ZRANGE with REV and LIMIT 1 gets the oldest (lowest score) entry
      const oldest = await client.zrange(redisKey, 0, 0, 'BYSCORE');
      if (oldest && oldest.length > 0) {
        const score = await client.zscore(redisKey, oldest[0]);
        return score ? Math.floor(parseFloat(score)) : Date.now();
      }
      return Date.now();
    } catch {
      return Date.now();
    }
  }

  private buildResult(scope: RateLimitScope, count: number, oldestTimestamp: number, now: number): RateLimitResult {
    const remaining = Math.max(0, this.max - count);
    const reset = oldestTimestamp + this.windowMs;

    return {
      allowed: count < this.max,
      current: count,
      limit: this.max,
      remaining,
      reset,
      windowMs: this.windowMs,
      scope,
    };
  }

  private failOpenResult(scope: RateLimitScope): RateLimitResult {
    return {
      allowed: true,
      current: 0,
      limit: this.max,
      remaining: 1,
      reset: Date.now() + this.windowMs,
      windowMs: this.windowMs,
      scope,
    };
  }
}

/**
 * Default singleton instance using the app-level config.
 */
export const rateLimiter = new RateLimiter();
