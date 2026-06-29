/**
 * Redis token bucket rate limiter via Lua atomic script.
 *
 * Uses INCR + PEXPIRE atomic Lua script to implement a fixed-window
 * counter rate limiter. The Lua script ensures atomic check-and-increment
 * for correct concurrency under high load.
 *
 * ── Algorithm ────────────────────────────────────────────────────────
 * 1. INCR the key
 * 2. If this is the first increment, set PEXPIRE
 * 3. If current value exceeds maxTokens, deny
 * 4. Return { allowed, remaining, resetMs }
 * ─────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-limiter' });

const CHECK_SCRIPT = `
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
local ttl = redis.call('PTTL', key)
local remaining = maxTokens - current
if remaining < 0 then
  remaining = 0
end
local allowed = 0
if current <= maxTokens then
  allowed = 1
end
return {allowed, remaining, ttl}
`;

export interface RateLimitResult {
  /** Whether the request is allowed (within limits). */
  allowed: boolean;
  /** Remaining tokens in the window. */
  remaining: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
}

export class TokenBucketRateLimiter {
  private readonly redis: Redis;
  private checkSha: string | null = null;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, 'RateLimiter Redis retry in ${delay}ms');
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('error', (err: Error) => {
      log.error({ err: String(err) }, 'RateLimiter Redis connection error');
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
      await this.redis.connect();
    }
  }

  private async getCheckSha(): Promise<string> {
    if (!this.checkSha) {
      const sha = await this.redis.script('LOAD', CHECK_SCRIPT);
      this.checkSha = typeof sha === 'string' ? sha : null;
    }
    return this.checkSha ?? '';
  }

  /**
   * Check if a request is allowed for the given key.
   * Atomically increments the counter and returns the new state.
   *
   * @param key - Rate limit key (e.g. "github:api:user-123")
   * @param maxTokens - Maximum number of tokens allowed in the window
   * @param windowMs - Window duration in milliseconds
   * @returns RateLimitResult with allowed, remaining, and resetMs
   */
  async check(
    key: string,
    maxTokens: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    try {
      await this.ensureConnected();
      const redisKey = `stas:ratelimit:${key}`;
      const sha = await this.getCheckSha();
      const now = Date.now();

      const result = await this.redis.evalsha(
        sha,
        1,
        redisKey,
        String(maxTokens),
        String(windowMs),
        String(now),
      );

      if (Array.isArray(result) && result.length >= 3) {
        return {
          allowed: result[0] === 1,
          remaining: Number(result[1]),
          resetMs: Number(result[2]),
        };
      }

      return { allowed: true, remaining: maxTokens, resetMs: windowMs };
    } catch (err) {
      log.error({ err: String(err), key }, 'Rate limit check failed — allowing request');
      return { allowed: true, remaining: 1, resetMs: windowMs };
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing RateLimiter Redis');
    }
  }
}
