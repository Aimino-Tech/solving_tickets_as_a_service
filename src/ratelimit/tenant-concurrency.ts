/**
 * Per-tenant concurrency controller.
 *
 * Manages concurrent agent runs per tenant using Redis atomic counters.
 * Uses INCR/DECR with TTL to prevent stuck counts from crashed agents.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * Each tenant has a Redis key `tenant:{tenantId}:active` storing the current
 * count of active agent runs. The key has a TTL that gets refreshed on each
 * acquire, providing automatic cleanup if an agent crashes without releasing.
 *
 * Concurrency limits are tier-based:
 *   - Free:       1 concurrent run
 *   - Pro:        3 concurrent runs
 *   - Enterprise: 10 concurrent runs
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ Redis failures are caught and logged — acquire returns false (safe block)
 * ✅ Release failures are non-fatal (slot auto-expires via TTL)
 * ✅ TTL prevents stuck counts from crashed agents
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'tenant-concurrency' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_KEY_PREFIX = 'tenant:';
const ACTIVE_SUFFIX = ':active';
const DEFAULT_TTL_S = 600; // 10 minutes — matches FIX_TIMEOUT_MS

// ---------------------------------------------------------------------------
// Tier to concurrency limit mapping
// ---------------------------------------------------------------------------

export type TenantTier = 'free' | 'pro' | 'enterprise';

/**
 * Get the max concurrent agents for a given tenant tier.
 */
export function getMaxConcurrentForTier(tier: TenantTier): number {
  switch (tier) {
    case 'free':
      return config.rateLimit.tenant.maxConcurrentFree;
    case 'pro':
      return config.rateLimit.tenant.maxConcurrentPro;
    case 'enterprise':
      return config.rateLimit.tenant.maxConcurrentEnterprise;
    default:
      return config.rateLimit.tenant.maxConcurrentFree;
  }
}

// ---------------------------------------------------------------------------
// TenantConcurrencyManager
// ---------------------------------------------------------------------------

export class TenantConcurrencyManager {
  private redisClient: Redis | null = null;
  private readonly ttlSeconds: number;

  constructor(ttlSeconds: number = DEFAULT_TTL_S) {
    this.ttlSeconds = ttlSeconds;
  }

  // ── Redis client (lazy) ────────────────────────────────────────────────

  private getClient(): Redis {
    if (!this.redisClient) {
      this.redisClient = new Redis(config.queue.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          log.warn({ attempt: times }, `Tenant concurrency Redis retry in ${delay}ms`);
          return delay;
        },
        lazyConnect: true,
      });

      this.redisClient.on('error', (err) => {
        log.error({ err: String(err) }, 'Tenant concurrency Redis connection error');
      });
    }
    return this.redisClient;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Attempt to acquire a concurrency slot for a tenant.
   *
   * Atomically increments the active count if the tenant is under their
   * concurrency limit. Sets/refreshes the TTL on the key.
   *
   * @param tenantId - The tenant identifier
   * @param maxConcurrent - Max concurrent agents for this tenant's tier
   * @returns true if the slot was acquired, false if at capacity
   */
  async acquire(tenantId: string, maxConcurrent: number): Promise<boolean> {
    try {
      const client = this.getClient();
      const key = this.activeKey(tenantId);

      // Atomically increment and set TTL
      const multi = client.multi();
      multi.incr(key);
      multi.expire(key, this.ttlSeconds);
      const results = await multi.exec();

      if (!results) {
        log.warn({ tenantId }, 'Redis multi-exec returned null for acquire');
        return false;
      }

      const activeCount = results[0]?.[1] as number | undefined;

      if (activeCount === undefined) {
        log.warn({ tenantId }, 'Could not read active count from Redis');
        return false;
      }

      if (activeCount <= maxConcurrent) {
        log.info(
          { tenantId, activeCount, maxConcurrent },
          'Tenant concurrency slot acquired',
        );
        return true;
      }

      // Over limit — decrement back
      await client.decr(key);
      log.warn(
        { tenantId, activeCount, maxConcurrent },
        'Tenant concurrency limit reached — slot denied',
      );
      return false;
    } catch (err) {
      log.error(
        { err: String(err), tenantId },
        'Tenant concurrency acquire failed — blocking request (fail-closed)',
      );
      return false;
    }
  }

  /**
   * Release a concurrency slot for a tenant.
   *
   * Decrements the active count. The count will also auto-expire via TTL
   * if release is never called (e.g. agent crash).
   */
  async release(tenantId: string): Promise<void> {
    try {
      const client = this.getClient();
      const key = this.activeKey(tenantId);

      const count = await client.decr(key);

      // If count dropped below 0, reset to 0
      if (count < 0) {
        await client.set(key, 0, 'EX', this.ttlSeconds);
      }

      log.info({ tenantId, activeCount: Math.max(0, count) }, 'Tenant concurrency slot released');
    } catch (err) {
      log.warn(
        { err: String(err), tenantId },
        'Failed to release tenant concurrency slot — will auto-expire via TTL',
      );
    }
  }

  /**
   * Get the current active agent count for a tenant.
   */
  async getActiveCount(tenantId: string): Promise<number> {
    try {
      const client = this.getClient();
      const key = this.activeKey(tenantId);
      const count = await client.get(key);
      return count ? Number.parseInt(count, 10) : 0;
    } catch (err) {
      log.error({ err: String(err), tenantId }, 'Failed to get active count');
      return 0;
    }
  }

  /**
   * Reset the active count for a tenant to zero.
   * Useful for manual overrides or recovery.
   */
  async resetCount(tenantId: string): Promise<void> {
    try {
      const client = this.getClient();
      const key = this.activeKey(tenantId);
      await client.set(key, 0, 'EX', this.ttlSeconds);
      log.info({ tenantId }, 'Tenant active count reset to 0');
    } catch (err) {
      log.error({ err: String(err), tenantId }, 'Failed to reset tenant active count');
    }
  }

  /**
   * Close the Redis client. Used during graceful shutdown.
   */
  async close(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch (err) {
        log.warn({ err: String(err) }, 'Error closing tenant concurrency Redis client');
      }
      this.redisClient = null;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private activeKey(tenantId: string): string {
    return `${TENANT_KEY_PREFIX}${tenantId}${ACTIVE_SUFFIX}`;
  }
}

/**
 * Default singleton instance.
 */
export const tenantConcurrencyManager = new TenantConcurrencyManager();
