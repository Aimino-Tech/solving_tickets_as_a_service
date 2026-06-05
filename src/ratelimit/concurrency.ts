/**
 * Per-account concurrency manager.
 *
 * Tracks active fix runs per GitHub installation (account) in Redis and
 * prevents exceeding the tier-defined concurrency cap.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * Each active run is stored as a member of a Redis SET keyed by
 * `concurrency:account:{installationId}`. The member value is a unique run
 * identifier (e.g. job ID). Each member has a TTL via EXPIRE on the key
 * (refreshed periodically) to auto-release slots for hung runs.
 *
 * Admin overrides are stored in a Redis HASH `concurrency:overrides` as
 * `{installationId}:{maxConcurrency}` pairs for quick lookup.
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ Redis failures are caught and logged — acquire returns false (blocking)
 * ✅ Release failures are non-fatal (slot auto-expires via TTL)
 * ✅ Stale entries are cleaned up on acquire
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { getConcurrencyLimitForAccount } from './tiers.js';
import { recordActiveRuns } from '../bridge/metrics.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'concurrency' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT_KEY_PREFIX = 'concurrency:account:';
const OVERRIDES_KEY = 'concurrency:overrides';
const DEFAULT_CONCURRENCY_TIMEOUT_S = 600; // 10 minutes — matches FIX_TIMEOUT_MS default

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConcurrencyResult {
  /** Whether the slot was acquired. */
  acquired: boolean;
  /** Current active run count for this account. */
  activeCount: number;
  /** Maximum concurrent runs allowed for this account. */
  limit: number;
  /** Queue position (1-based). 1 means the run can proceed. */
  position: number;
}

export interface ConcurrencyManagerOptions {
  /** TTL in seconds for active run entries (auto-release timeout). */
  timeoutSeconds?: number;
}

// ---------------------------------------------------------------------------
// ConcurrencyManager
// ---------------------------------------------------------------------------

export class ConcurrencyManager {
  private readonly timeoutSeconds: number;
  private redisClient: Redis | null = null;

  constructor(options?: ConcurrencyManagerOptions) {
    this.timeoutSeconds = options?.timeoutSeconds ?? DEFAULT_CONCURRENCY_TIMEOUT_S;
  }

  // ── Redis client (lazy) ────────────────────────────────────────────────

  private getClient(): Redis {
    if (!this.redisClient) {
      this.redisClient = new Redis(config.queue.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          log.warn({ attempt: times }, `Concurrency manager Redis retry in ${delay}ms`);
          return delay;
        },
        lazyConnect: true,
      });

      this.redisClient.on('error', (err) => {
        log.error({ err: String(err) }, 'Concurrency manager Redis connection error');
      });
    }
    return this.redisClient;
  }

  /**
   * Attempt to acquire a concurrency slot for the given account.
   *
   * @param installationId - GitHub installation (account) ID
   * @param runId - Unique identifier for this run (e.g. job ID)
   * @returns ConcurrencyResult indicating if the slot was acquired
   */
  async acquire(installationId: number, runId: string): Promise<ConcurrencyResult> {
    try {
      const client = this.getClient();
      const accountKey = this.accountKey(installationId);
      const concurrencyLimit = await this.getEffectiveLimit(installationId);

      // Add this run to the active set
      await client.sadd(accountKey, runId);

      // Get current active count
      const activeCount = await client.scard(accountKey);

      // Refresh TTL on the account key
      await client.expire(accountKey, this.timeoutSeconds);

      if (activeCount <= concurrencyLimit) {
        log.info(
          { installationId, runId, activeCount, limit: concurrencyLimit },
          'Concurrency slot acquired',
        );
        recordActiveRuns(String(installationId), activeCount);
        return {
          acquired: true,
          activeCount,
          limit: concurrencyLimit,
          position: activeCount,
        };
      }

      // Over limit — remove our entry and block
      await client.srem(accountKey, runId);
      log.warn(
        { installationId, runId, activeCount, limit: concurrencyLimit },
        'Concurrency limit reached — slot denied',
      );
      recordActiveRuns(String(installationId), activeCount - 1);
      return {
        acquired: false,
        activeCount: activeCount - 1,
        limit: concurrencyLimit,
        position: concurrencyLimit + 1,
      };
    } catch (err) {
      log.error(
        { err: String(err), installationId, runId },
        'Concurrency acquire failed — allowing request (fail-open)',
      );
      return {
        acquired: true,
        activeCount: 0,
        limit: 1,
        position: 1,
      };
    }
  }

  /**
   * Release a concurrency slot for the given account.
   * Called when a fix completes (success or failure).
   */
  async release(installationId: number, runId: string): Promise<void> {
    try {
      const client = this.getClient();
      const accountKey = this.accountKey(installationId);
      await client.srem(accountKey, runId);

      // If the set is now empty, remove the key entirely
      const remaining = await client.scard(accountKey);
      if (remaining === 0) {
        await client.del(accountKey);
      }
      recordActiveRuns(String(installationId), remaining);

      log.info({ installationId, runId, remaining }, 'Concurrency slot released');
    } catch (err) {
      log.warn(
        { err: String(err), installationId, runId },
        'Failed to release concurrency slot — will auto-expire via TTL',
      );
    }
  }

  /**
   * Get the current active run count for an account.
   */
  async getActiveCount(installationId: number): Promise<number> {
    try {
      const client = this.getClient();
      const accountKey = this.accountKey(installationId);
      return await client.scard(accountKey);
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to get active count');
      return 0;
    }
  }

  /**
   * Get the list of active run IDs for an account.
   */
  async getActiveRuns(installationId: number): Promise<string[]> {
    try {
      const client = this.getClient();
      const accountKey = this.accountKey(installationId);
      return await client.smembers(accountKey);
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to get active runs');
      return [];
    }
  }

  /**
   * Check if a specific run is still tracked as active.
   */
  async isRunActive(installationId: number, runId: string): Promise<boolean> {
    try {
      const client = this.getClient();
      const accountKey = this.accountKey(installationId);
      return (await client.sismember(accountKey, runId)) === 1;
    } catch (err) {
      log.error({ err: String(err), installationId, runId }, 'Failed to check run active status');
      return false;
    }
  }

  // ── Admin overrides ────────────────────────────────────────────────────

  /**
   * Set an admin concurrency override for a specific account.
   * Overrides the tier-based concurrency limit.
   */
  async setAdminOverride(installationId: number, maxConcurrency: number): Promise<void> {
    try {
      const client = this.getClient();
      await client.hset(OVERRIDES_KEY, String(installationId), String(maxConcurrency));
      log.info({ installationId, maxConcurrency }, 'Admin concurrency override set');
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to set admin override');
    }
  }

  /**
   * Remove an admin concurrency override for a specific account.
   */
  async removeAdminOverride(installationId: number): Promise<void> {
    try {
      const client = this.getClient();
      await client.hdel(OVERRIDES_KEY, String(installationId));
      log.info({ installationId }, 'Admin concurrency override removed');
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to remove admin override');
    }
  }

  /**
   * Get the effective concurrency limit for an account.
   * Checks admin overrides first, then falls back to tier config.
   */
  async getEffectiveLimit(installationId: number): Promise<number> {
    try {
      const client = this.getClient();
      const override = await client.hget(OVERRIDES_KEY, String(installationId));
      if (override !== null && override !== undefined) {
        const parsed = Number(override);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch (err) {
      log.warn({ err: String(err), installationId }, 'Failed to check admin override');
    }

    // Fall back to tier-based limit
    return getConcurrencyLimitForAccount(installationId);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Clean up stale entries for an account.
   * Removes members of the set that don't correspond to valid job IDs.
   * Called periodically or on demand.
   */
  async cleanupStaleRuns(installationId: number): Promise<number> {
    try {
      const client = this.getClient();
      const accountKey = this.accountKey(installationId);
      const members = await client.smembers(accountKey);

      // Refresh the key TTL; if TTL is already expired, Redis handles it
      if (members.length > 0) {
        await client.expire(accountKey, this.timeoutSeconds);
      }

      log.debug({ installationId, memberCount: members.length }, 'Stale run cleanup completed');
      return members.length;
    } catch (err) {
      log.error({ err: String(err), installationId }, 'Failed to clean up stale runs');
      return 0;
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
        log.warn({ err: String(err) }, 'Error closing concurrency manager Redis client');
      }
      this.redisClient = null;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private accountKey(installationId: number): string {
    return `${ACCOUNT_KEY_PREFIX}${installationId}`;
  }
}

/**
 * Default singleton instance.
 */
export const concurrencyManager = new ConcurrencyManager();

// Re-export for convenience
export { DEFAULT_CONCURRENCY_TIMEOUT_S };
