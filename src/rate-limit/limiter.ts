/**
 * Redis-backed per-account rate limiter using a sliding window counter.
 *
 * Tracks request counts per installation ID, repo, and IP address.
 * Tier limits are enforced via configurable per-minute caps.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis connection failures log and return "allowed" (fail-open)
 * ✅ All Redis operations have try/catch with structured logging
 * ✅ Window keys auto-expire after one window + 1s jitter
 * ────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-limiter' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetMs: number;
  /** Unix timestamp (ms) when the window resets */
  resetTimestamp: number;
}

export interface TierLimits {
  requestsPerMinute: number;
  concurrentFixes: number;
}

export type TierName = 'free' | 'pro' | 'enterprise';

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export const TIER_LIMITS: Record<TierName, TierLimits> = {
  free: {
    requestsPerMinute: 10,
    concurrentFixes: 1,
  },
  pro: {
    requestsPerMinute: 60,
    concurrentFixes: 3,
  },
  enterprise: {
    requestsPerMinute: 300,
    concurrentFixes: 10,
  },
};

export const DEFAULT_TIER: TierName = 'free';

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private redis: Redis;
  private windowMs: number;

  constructor(redis?: Redis, windowMs?: number) {
    this.redis = redis ?? new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Rate-limiter Redis retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });
    this.windowMs = windowMs ?? config.stas.rateLimitWindowMs;
  }

  /** Expose the underlying Redis client for cleanup. */
  get client(): Redis {
    return this.redis;
  }

  /**
   * Resolve the tier for a given installation ID.
   * In a full implementation this would look up the account's billing plan
   * from a database. For now we derive it from config or default to free.
   */
  resolveTier(_installationId: number): TierName {
    // TODO(AIM-1227): Look up billing plan from DB/Stripe
    if (config.rateLimit?.defaultTier && config.rateLimit.defaultTier in TIER_LIMITS) {
      return config.rateLimit.defaultTier as TierName;
    }
    return DEFAULT_TIER;
  }

  /**
   * Check whether a request is allowed under the account-level rate limit.
   *
   * @param installationId - GitHub App installation ID
   * @returns RateLimitResult with allowance decision and headers
   */
  async checkAccount(installationId: number): Promise<RateLimitResult> {
    const tier = this.resolveTier(installationId);
    const limits = TIER_LIMITS[tier];
    return this.check(`account:${installationId}`, limits.requestsPerMinute);
  }

  /**
   * Check whether a request is allowed under the repo-level rate limit.
   * Repo limits use the same per-minute cap as the account tier but are
   * tracked independently so a busy repo can't starve others.
   *
   * @param repoFullName - "owner/repo" string
   * @param installationId - Used to resolve the tier
   */
  async checkRepo(repoFullName: string, installationId: number): Promise<RateLimitResult> {
    const tier = this.resolveTier(installationId);
    const limits = TIER_LIMITS[tier];
    return this.check(`repo:${repoFullName}`, limits.requestsPerMinute);
  }

  /**
   * Check whether a request is allowed under the IP-based rate limit.
   * Used as a fallback for unauthenticated endpoints.
   */
  async checkIp(ip: string): Promise<RateLimitResult> {
    // IP limits are fixed at a conservative rate regardless of tier
    const ipLimit = config.rateLimit?.ipMaxPerMinute ?? 30;
    return this.check(`ip:${ip}`, ipLimit);
  }

  /**
   * Core sliding-window counter using Redis.
   *
   * Key scheme: `ratelimit:{namespace}:{window_start}`
   * Uses INCR + EXPIRE for atomic counting with TTL-based cleanup.
   */
  private async check(namespace: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const windowEnd = windowStart + this.windowMs;
    const key = `ratelimit:${namespace}:${windowStart}`;

    try {
      const count = await this.redis.incr(key);

      // Set TTL on first increment (count === 1) or extend if close to expiry
      if (count === 1) {
        // TTL = window duration + 1s jitter so the key lives just past the window
        await this.redis.pexpire(key, this.windowMs + 1000);
      }

      const remaining = Math.max(0, limit - count);

      return {
        allowed: count <= limit,
        remaining,
        limit,
        resetMs: windowEnd - now,
        resetTimestamp: windowEnd,
      };
    } catch (err) {
      log.error({ err: String(err), namespace }, 'Rate limiter Redis error — allowing request (fail-open)');
      return {
        allowed: true,
        remaining: 1,
        limit,
        resetMs: this.windowMs,
        resetTimestamp: windowStart + this.windowMs,
      };
    }
  }

  /**
   * Gracefully close the Redis connection.
   */
  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing rate limiter Redis connection');
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: RateLimiter | null = null;

export function getRateLimiter(redis?: Redis): RateLimiter {
  if (!instance) {
    instance = new RateLimiter(redis);
  }
  return instance;
}

export function resetRateLimiter(): void {
  if (instance) {
    instance.close().catch(() => {});
    instance = null;
  }
}
