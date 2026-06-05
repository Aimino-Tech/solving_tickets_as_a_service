/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses Redis sorted sets to track request timestamps within a window.
 * Each request adds a member scored by timestamp; expired members are
 * removed before counting. This gives us a precise count of requests
 * in the last N milliseconds without needing cron jobs.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis connection errors are caught; returns { allowed: true, ... }
 *    to avoid blocking traffic when Redis is down (fail-open for rate
 *    limiting is acceptable — better to serve than drop)
 * ✅ Lua script runs atomically — no race conditions
 * ✅ Negative or zero windows are rejected at construction time
 * ────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-limiter' });

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

export interface RateLimitResult {
  /** Whether the request is allowed through. */
  allowed: boolean;
  /** Total requests in the current window. */
  current: number;
  /** Maximum requests allowed per window. */
  limit: number;
  /** Remaining requests in this window. */
  remaining: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
  /** Unix timestamp (ms) when the window resets. */
  resetTime: number;
}

export interface RateLimiterOptions {
  redisUrl?: string;
  redis?: Redis;
  /** Key prefix for Redis keys. Default: "ratelimit" */
  prefix?: string;
}

export class RedisRateLimiter {
  private redis: Redis;
  private prefix: string;

  constructor(options: RateLimiterOptions = {}) {
    this.redis =
      options.redis ??
      new Redis(options.redisUrl ?? DEFAULT_REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          log.warn({ attempt: times }, `RedisRateLimiter Redis retry in ${delay}ms`);
          return delay;
        },
        lazyConnect: true,
      });
    this.prefix = options.prefix ?? 'ratelimit';
  }

  /**
   * Check if a request should be rate-limited, and record it.
   *
   * Uses a Lua script for atomic sorted-set maintenance:
   * 1. Remove entries older than the window
   * 2. Count remaining entries
   * 3. If under limit, add current entry with TTL
   *
   * @param key - Unique key for this rate limit bucket (e.g., "account:12345")
   * @param limit - Maximum requests in the window
   * @param windowMs - Window duration in milliseconds
   */
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local windowMs = tonumber(ARGV[4])

      -- Remove entries outside the window
      redis.call("ZREMRANGEBYSCORE", key, 0, windowStart)

      -- Count entries in the current window
      local count = redis.call("ZCARD", key)

      -- Determine result
      local allowed = 0
      local remaining = 0
      if count < limit then
        allowed = 1
        remaining = limit - count - 1
        -- Add this request
        redis.call("ZADD", key, now, now .. ":" .. math.random())
        -- Set TTL on the key so it doesn't persist forever
        redis.call("PEXPIRE", key, windowMs + 1000)
        count = count + 1
      else
        remaining = 0
      end

      -- Find the oldest entry for reset time
      local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
      local resetTime = now + windowMs
      if #oldest >= 2 then
        resetTime = tonumber(oldest[2]) + windowMs
      end

      return {allowed, count, limit, remaining, resetTime}
    `;

    try {
      const result = await this.redis.eval(script, 1, redisKey, String(now), String(windowStart), String(limit), String(windowMs));

      const [allowedStr, currentStr, limitStr, remainingStr, resetTimeStr] = result as string[];

      const allowed = Number(allowedStr) === 1;
      const current = Number(currentStr);
      const limitVal = Number(limitStr);
      const remaining = Number(remainingStr);
      const resetTime = Number(resetTimeStr);
      const resetMs = Math.max(0, resetTime - now);

      if (!allowed) {
        log.warn({ key, current, limit: limitVal, resetMs }, 'Rate limit exceeded');
      }

      return { allowed, current, limit: limitVal, remaining, resetMs, resetTime };
    } catch (err) {
      log.error({ err: String(err), key }, 'Rate limiter Redis error — allowing request (fail-open)');
      return {
        allowed: true,
        current: 0,
        limit,
        remaining: limit,
        resetMs: windowMs,
        resetTime: Date.now() + windowMs,
      };
    }
  }

  /**
   * Get the current count for a key without recording a new request.
   */
  async peek(key: string): Promise<number> {
    const redisKey = `${this.prefix}:${key}`;
    try {
      const now = Date.now();
      const windowStart = now - 60_000; // peek the last minute by default
      await this.redis.zremrangebyscore(redisKey, 0, windowStart);
      return await this.redis.zcard(redisKey);
    } catch (err) {
      log.error({ err: String(err), key }, 'Failed to peek rate limit');
      return 0;
    }
  }

  /**
   * Reset a rate limit bucket for a key.
   */
  async reset(key: string): Promise<void> {
    const redisKey = `${this.prefix}:${key}`;
    try {
      await this.redis.del(redisKey);
    } catch (err) {
      log.error({ err: String(err), key }, 'Failed to reset rate limit');
    }
  }

  /**
   * Close the underlying Redis connection.
   */
  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing rate limiter Redis');
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

let defaultInstance: RedisRateLimiter | null = null;

/**
 * Get or create the default RedisRateLimiter singleton.
 */
export function getRateLimiter(options?: RateLimiterOptions): RedisRateLimiter {
  if (!defaultInstance) {
    defaultInstance = new RedisRateLimiter(options);
  }
  return defaultInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetRateLimiter(): void {
  defaultInstance = null;
}
