/**
 * UsageTracker — Usage tracking service for STAS.
 *
 * Provides:
 *   - Recording usage events with tier gating
 *   - Querying current usage and remaining quota
 *   - Determining the active plan for a repository
 *   - Checking whether an action is allowed under the current tier
 */

import { getTierConfig, UNLIMITED, type TierConfig, type TierName } from '../config/tiers.js';
import { UsageStore, currentYearMonth } from './usage-store-sqlite.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'usage-tracker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  /** GitHub user ID or authenticated user identifier. */
  userId: string;
  /** Repository identifier (e.g. "owner/repo"). */
  repoId: string;
  /** Action performed (e.g. "fix-run", "triage", "sandbox"). */
  action: string;
  /** Arbitrary metadata attached to the record. */
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  /** Current monthly usage count. */
  currentMonthUsage: number;
  /** Max fixes allowed this month. */
  monthlyLimit: number;
  /** Remaining fixes this month. */
  remaining: number;
  /** Tier name at the time of query. */
  plan: string;
  /** ISO timestamp of when usage resets. */
  resetAt: string;
  /** Whether the tier is unlimited. */
  unlimited: boolean;
}

export interface QuotaCheck {
  /** Whether the action is allowed under current tier limits. */
  allowed: boolean;
  /** If denied, a human-readable reason. */
  reason: string | null;
  /** HTTP status code for the denial (if denied). */
  statusCode: number;
}

// ---------------------------------------------------------------------------
// UsageTracker
// ---------------------------------------------------------------------------

export class UsageTracker {
  private store: UsageStore;

  /**
   * @param store  UsageStore instance. Defaults to a new in-memory store
   *               for backward compatibility; production code should pass
   *               a configured store explicitly.
   */
  constructor(store?: UsageStore) {
    this.store = store ?? new UsageStore(':memory:');
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record a usage event and increment the monthly counter.
   * Does NOT enforce tier limits — use `checkQuota` before calling.
   */
  record(record: UsageRecord): void {
    const tierConfig = getTierConfigForRepo(record.repoId);
    const yearMonth = currentYearMonth();

    this.store.record(record.userId, record.repoId, record.action, tierConfig.displayName, record.metadata);

    if (record.action === 'fix-run') {
      this.store.incrementMonthly(record.userId, record.repoId, yearMonth);
    }

    log.info(
      {
        userId: record.userId,
        repoId: record.repoId,
        action: record.action,
        tier: tierConfig.displayName,
      },
      'Usage recorded',
    );
  }

  /**
   * Get the current usage summary for a user + repo.
   */
  getUsage(userId: string, repoId: string): UsageSummary {
    const tierConfig = getTierConfigForRepo(repoId);
    const currentMonthUsage = this.store.getCurrentMonthCount(userId, repoId);

    return {
      currentMonthUsage,
      monthlyLimit: tierConfig.monthlyFixLimit,
      remaining: calculateRemaining(tierConfig.monthlyFixLimit, currentMonthUsage),
      plan: tierConfig.displayName,
      resetAt: this.store.getResetTimestamp(userId, repoId),
      unlimited: tierConfig.monthlyFixLimit === UNLIMITED,
    };
  }

  /**
   * Get the plan/display name for a repository.
   */
  getPlan(repoId: string): string {
    return getTierConfigForRepo(repoId).displayName;
  }

  /**
   * Check whether an action is allowed under the current tier's quota.
   * Returns both the boolean decision and contextual information for
   * constructing error responses.
   */
  checkQuota(userId: string, repoId: string, action: string): QuotaCheck {
    const tierConfig = getTierConfigForRepo(repoId);

    // Self-hosted and non-fix actions are always allowed
    if (action !== 'fix-run' || tierConfig.monthlyFixLimit === UNLIMITED) {
      return { allowed: true, reason: null, statusCode: 200 };
    }

    const currentMonthUsage = this.store.getCurrentMonthCount(userId, repoId);

    if (currentMonthUsage >= tierConfig.monthlyFixLimit) {
      return {
        allowed: false,
        reason: `Monthly fix limit of ${tierConfig.monthlyFixLimit} reached. Upgrade at https://stas.ai/pricing`,
        statusCode: 402,
      };
    }

    return { allowed: true, reason: null, statusCode: 200 };
  }

  /**
   * Check whether a feature is enabled for the repo's tier.
   */
  hasFeature(repoId: string, feature: string): boolean {
    const tierConfig = getTierConfigForRepo(repoId);
    return tierConfig.features.includes(feature);
  }

  /**
   * Get the raw tier configuration for a repo.
   */
  getTierConfig(repoId: string): TierConfig {
    return getTierConfigForRepo(repoId);
  }

  /**
   * Return the underlying store (for testing).
   */
  getStore(): UsageStore {
    return this.store;
  }

  /** Close the underlying store. */
  close(): void {
    this.store.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the tier config for a repository.
 *
 * In the current implementation this uses the default tier from environment
 * config. In a hosted deployment this would look up the subscription plan
 * associated with the repository owner's account.
 */
function getTierConfigForRepo(repoId: string): TierConfig {
  // Use process.env for the tier mapping.
  // In production with a hosted deployment, this would query a subscription
  // service. For self-hosted OSS, we read from the environment variable.
  const tierOverride = process.env[`STAS_TIER_${repoId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (tierOverride) {
    return getTierConfig(tierOverride);
  }

  // Fallback to the default tier from env
  const defaultTier = process.env.STAS_DEFAULT_TIER ?? 'cloud-free';
  return getTierConfig(defaultTier);
}

/**
 * Calculate remaining fixes, capping at 0 for unlimited tiers.
 */
function calculateRemaining(limit: number, used: number): number {
  if (limit === UNLIMITED) return UNLIMITED;
  return Math.max(0, limit - used);
}
