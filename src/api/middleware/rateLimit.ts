/**
 * Tier-based rate limiter middleware.
 *
 * Uses Redis (via ioredis) to enforce daily request limits per subscriber:
 *   - Free:        10 requests/day
 *   - Pro:        100 requests/day
 *   - Enterprise: 1000 requests/day
 *
 * The subscriber's plan is read from req.plan (set by rapidApiAuth).
 * Returns 429 Too Many Requests when the limit is exceeded.
 */

import type { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'rapidapi-rate-limit' });

// ---------------------------------------------------------------------------
// Tier limits
// ---------------------------------------------------------------------------

const TIER_LIMITS: Record<string, number> = {
  free: 10,
  pro: 100,
  enterprise: 1000,
};

// ---------------------------------------------------------------------------
// Redis client (lazy — created on first use)
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      keyPrefix: 'rapidapi:rl:',
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });

    redis.on('error', (err) => {
      log.error({ err: String(err) }, 'Rate limiter Redis error');
    });

    await redis.connect();
  }
  return redis;
}

// ---------------------------------------------------------------------------
// Rate limit middleware
// ---------------------------------------------------------------------------

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  const plan = req.plan ?? 'free';
  const maxRequests = TIER_LIMITS[plan] ?? TIER_LIMITS.free;
  const key = plan; // Per-tier shared counter
  const windowSeconds = 86_400; // 24 hours

  try {
    const client = await getRedis();
    const now = Date.now();
    const windowStart = Math.floor(now / 1000) - windowSeconds;

    // Remove old entries outside the window
    await client.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    const requestCount = await client.zcard(key);

    if (requestCount >= maxRequests) {
      const retryAfter = windowSeconds - (Math.floor(now / 1000) - windowStart);
      log.warn(
        { plan, requestCount, maxRequests, ip: req.ip },
        'RapidAPI rate limit exceeded',
      );

      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.floor(now / 1000) + retryAfter));

      return res.status(429).json({
        error: 'Rate limit exceeded',
        plan,
        limit: maxRequests,
        remaining: 0,
        resetAt: new Date(now + retryAfter * 1000).toISOString(),
      });
    }

    // Add current request timestamp
    await client.zadd(key, Math.floor(now / 1000), `${now}-${Math.random()}`);

    // Set TTL on the key (cleanup after window + 1 hour)
    await client.expire(key, windowSeconds + 3600);

    // Set rate limit headers
    const remaining = maxRequests - requestCount - 1;
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
    res.setHeader('X-RateLimit-Plan', plan);

    next();
  } catch (err) {
    // If Redis is unavailable, allow the request (fail open)
    log.error({ err: String(err) }, 'Rate limiter Redis error — allowing request');
    next();
  }
}
