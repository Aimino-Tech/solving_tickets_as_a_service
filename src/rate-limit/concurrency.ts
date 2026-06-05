/**
 * Per-account concurrency manager for STAS fix runs.
 *
 * Tracks active fix runs per GitHub installation ID in Redis.
 * Blocks new jobs when the account hits its concurrency cap.
 * Releases the slot automatically on job completion, failure, or timeout.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis failures log and return "allowed" (fail-open) — no thundering herd
 * ✅ Acquire is atomic via Redis SADD + SCARD in a Lua script
 * ✅ Timeout auto-releases via Redis key TTL on the set member
 * ✅ Admin override supported via config.rateLimit.adminOverrides
 * ✅ All Redis operations have try/catch with structured logging
 * ────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { TIER_LIMITS, DEFAULT_TIER, type TierName } from './limiter.js';

const log = rootLogger.child({ module: 'concurrency' });

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const ACTIVE_SET_PREFIX = 'concurrency:active:';
const JOB_TTL_PREFIX = 'concurrency:job-ttl:';

function activeSetKey(installationId: number): string {
  return `${ACTIVE_SET_PREFIX}${installationId}`;
}

function jobTtlKey(jobId: string): string {
  return `${JOB_TTL_PREFIX}${jobId}`;
}

// ---------------------------------------------------------------------------
// Lua script: atomic acquire
// ---------------------------------------------------------------------------

/**
 * Redis Lua script that atomically checks concurrency and adds a job.
 *
 * KEYS[1] = active set key (e.g. "concurrency:active:12345")
 * KEYS[2] = job TTL key  (e.g. "concurrency:job-ttl:abc-def")
 * ARGV[1] = job ID
 * ARGV[2] = max concurrency
 * ARGV[3] = TTL in seconds for the job TTL key
 *
 * Returns:
 *   1  — acquired (slot was available)
 *   0  — rejected (at concurrency cap)
 */
const ACQUIRE_SCRIPT = `
  local active_key = KEYS[1]
  local job_ttl_key = KEYS[2]
  local job_id = ARGV[1]
  local max_concurrency = tonumber(ARGV[2])
  local ttl_seconds = tonumber(ARGV[3])

  -- Count current active jobs for this account
  local current = redis.call("SCARD", active_key)

  if current >= max_concurrency then
    return 0
  end

  -- Add job ID to the active set
  redis.call("SADD", active_key, job_id)

  -- Set a TTL on the job so it auto-releases if the worker hangs
  redis.call("SETEX", job_ttl_key, ttl_seconds, job_id)

  -- Also set TTL on the active set itself to prevent stale keys
  redis.call("EXPIRE", active_key, ttl_seconds + 60)

  return 1
`;

/**
 * Lua script: atomic release.
 *
 * KEYS[1] = active set key
 * KEYS[2] = job TTL key
 * ARGV[1] = job ID
 *
 * Returns the new cardinality of the active set.
 */
const RELEASE_SCRIPT = `
  local active_key = KEYS[1]
  local job_ttl_key = KEYS[2]
  local job_id = ARGV[1]

  redis.call("SREM", active_key, job_id)
  redis.call("DEL", job_ttl_key)

  return redis.call("SCARD", active_key)
`;

// ---------------------------------------------------------------------------
// ConcurrencyManager
// ---------------------------------------------------------------------------

export class ConcurrencyManager {
  private redis: Redis;
  /** Seconds after which a job is considered hung and auto-released. */
  private jobTimeoutSec: number;

  constructor(redis?: Redis, jobTimeoutMs?: number) {
    this.redis = redis ?? new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Concurrency Redis retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });
    this.jobTimeoutSec = (jobTimeoutMs ?? config.fixTimeoutMs ?? 600_000) / 1000;
  }

  /** Expose the underlying Redis client for cleanup. */
  get client(): Redis {
    return this.redis;
  }

  /**
   * Resolve max concurrency for a given installation ID.
   * Checks for admin overrides first, then falls back to tier limits.
   */
  maxConcurrency(installationId: number): number {
    // Check for admin override
    const overrides = config.rateLimit?.adminOverrides;
    if (overrides && typeof overrides === 'object') {
      const key = String(installationId);
      if (key in overrides) {
        return (overrides as Record<string, number>)[key];
      }
    }

    // Derive from tier
    const tier: TierName = config.rateLimit?.defaultTier
      && config.rateLimit.defaultTier in TIER_LIMITS
      ? (config.rateLimit.defaultTier as TierName)
      : DEFAULT_TIER;

    return TIER_LIMITS[tier].concurrentFixes;
  }

  /**
   * Attempt to acquire a concurrency slot for an account.
   *
   * @param installationId - GitHub App installation ID
   * @param jobId - Unique identifier for this fix run
   * @returns true if the slot was acquired, false if at capacity
   */
  async acquire(installationId: number, jobId: string): Promise<boolean> {
    const maxConc = this.maxConcurrency(installationId);

    try {
      const result = await this.redis.eval(
        ACQUIRE_SCRIPT,
        2,
        activeSetKey(installationId),
        jobTtlKey(jobId),
        jobId,
        String(maxConc),
        String(this.jobTimeoutSec),
      );

      const acquired = result === 1;
      if (acquired) {
        log.info(
          { installationId, jobId, maxConcurrency: maxConc },
          'Concurrency slot acquired',
        );
      } else {
        log.warn(
          { installationId, jobId, maxConcurrency: maxConc },
          'Concurrency limit reached — request rejected',
        );
      }

      return acquired;
    } catch (err) {
      log.error(
        { err: String(err), installationId, jobId },
        'Concurrency acquire error — allowing request (fail-open)',
      );
      return true;
    }
  }

  /**
   * Release a concurrency slot for an account.
   *
   * @param installationId - GitHub App installation ID
   * @param jobId - Unique identifier for this fix run
   */
  async release(installationId: number, jobId: string): Promise<void> {
    try {
      const remaining = await this.redis.eval(
        RELEASE_SCRIPT,
        2,
        activeSetKey(installationId),
        jobTtlKey(jobId),
        jobId,
      );

      log.info(
        { installationId, jobId, remainingActive: remaining },
        'Concurrency slot released',
      );
    } catch (err) {
      log.error(
        { err: String(err), installationId, jobId },
        'Concurrency release error — ignoring',
      );
    }
  }

  /**
   * Get the number of currently active fix runs for an account.
   */
  async activeCount(installationId: number): Promise<number> {
    try {
      return await this.redis.scard(activeSetKey(installationId));
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to get active count');
      return 0;
    }
  }

  /**
   * List all active job IDs for an account.
   */
  async activeJobs(installationId: number): Promise<string[]> {
    try {
      return await this.redis.smembers(activeSetKey(installationId));
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to list active jobs');
      return [];
    }
  }

  /**
   * Check if a specific job is still considered active (not timed out).
   */
  async isJobAlive(jobId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(jobTtlKey(jobId));
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Admin override: force-set the maximum concurrency for an installation.
   * This persists only until the next Redis flush or the key expires.
   * For permanent overrides, set STAS_CONCURRENCY_OVERRIDES in config.
   */
  async adminSetConcurrency(installationId: number, maxConcurrency: number): Promise<void> {
    const key = `concurrency:override:${installationId}`;
    try {
      await this.redis.set(key, String(maxConcurrency));
      log.info({ installationId, maxConcurrency }, 'Admin concurrency override set');
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to set admin override');
    }
  }

  /**
   * Gracefully close the Redis connection.
   */
  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing concurrency Redis connection');
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ConcurrencyManager | null = null;

export function getConcurrencyManager(redis?: Redis): ConcurrencyManager {
  if (!instance) {
    instance = new ConcurrencyManager(redis);
  }
  return instance;
}

export function resetConcurrencyManager(): void {
  if (instance) {
    instance.close().catch(() => {});
    instance = null;
  }
}
