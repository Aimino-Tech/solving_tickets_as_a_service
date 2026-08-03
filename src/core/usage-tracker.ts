/**
 * UsageTracker — Usage tracking service for SYNTARO.
 *
 * Provides:
 *   - Recording usage events with tier gating
 *   - Querying current usage and remaining quota
 *   - Determining the active plan for a repository
 *   - Checking whether an action is allowed under the current tier
 */

import { getTierConfig, UNLIMITED, type TierConfig } from '../config/tiers.js';
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
// In-memory store (replaces the old SQLite-backed UsageStore)
// ---------------------------------------------------------------------------

interface RecordEntry {
  userId: string;
  repoId: string;
  action: string;
  tierAtTime: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface MonthlyEntry {
  userId: string;
  repoId: string;
  yearMonth: string;
  fixCount: number;
}

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function monthlyKey(userId: string, repoId: string, yearMonth: string): string {
  return `${userId}::${repoId}::${yearMonth}`;
}

// ---------------------------------------------------------------------------
// UsageTracker
// ---------------------------------------------------------------------------

export class UsageTracker {
  private records: RecordEntry[] = [];
  private monthlyCounters = new Map<string, MonthlyEntry>();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record a usage event and increment the monthly counter.
   * Does NOT enforce tier limits — use `checkQuota` before calling.
   *
   * @param tierOverride  Optional tier name to override env-based resolution (e.g. 'pro', 'team')
   */
  record(record: UsageRecord, tierOverride?: string): void {
    const tierConfig = getTierConfigForRepo(record.repoId, tierOverride);
    const yearMonth = currentYearMonth();

    this.records.push({
      userId: record.userId,
      repoId: record.repoId,
      action: record.action,
      tierAtTime: tierConfig.displayName,
      timestamp: new Date(),
      metadata: record.metadata,
    });

    if (record.action === 'fix-run') {
      const key = monthlyKey(record.userId, record.repoId, yearMonth);
      const existing = this.monthlyCounters.get(key);
      if (existing) {
        existing.fixCount += 1;
      } else {
        this.monthlyCounters.set(key, {
          userId: record.userId,
          repoId: record.repoId,
          yearMonth,
          fixCount: 1,
        });
      }
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
   *
   * @param tierOverride  Optional tier name to override env-based resolution (e.g. 'pro', 'team')
   */
  getUsage(userId: string, repoId: string, tierOverride?: string): UsageSummary {
    const tierConfig = getTierConfigForRepo(repoId, tierOverride);
    const currentMonthUsage = this.getCurrentMonthCount(userId, repoId);

    return {
      currentMonthUsage,
      monthlyLimit: tierConfig.monthlyFixLimit,
      remaining: calculateRemaining(tierConfig.monthlyFixLimit, currentMonthUsage),
      plan: tierConfig.displayName,
      resetAt: nextMonthStart().toISOString(),
      unlimited: tierConfig.monthlyFixLimit === UNLIMITED,
    };
  }

  /**
   * Get the plan/display name for a repository.
   *
   * @param tierOverride  Optional tier name to override env-based resolution (e.g. 'pro', 'team')
   */
  getPlan(repoId: string, tierOverride?: string): string {
    return getTierConfigForRepo(repoId, tierOverride).displayName;
  }

  /**
   * Check whether an action is allowed under the current tier's quota.
   * Returns both the boolean decision and contextual information for
   * constructing error responses.
   *
   * @param tierOverride  Optional tier name to override env-based resolution (e.g. 'pro', 'team')
   */
  checkQuota(userId: string, repoId: string, action: string, tierOverride?: string): QuotaCheck {
    const tierConfig = getTierConfigForRepo(repoId, tierOverride);

    // Self-hosted and non-fix actions are always allowed
    if (action !== 'fix-run' || tierConfig.monthlyFixLimit === UNLIMITED) {
      return { allowed: true, reason: null, statusCode: 200 };
    }

    const currentMonthUsage = this.getCurrentMonthCount(userId, repoId);

    if (currentMonthUsage >= tierConfig.monthlyFixLimit) {
      return {
        allowed: false,
        reason: `Monthly fix limit of ${tierConfig.monthlyFixLimit} reached. Upgrade at https://syntaro.ai/pricing`,
        statusCode: 402,
      };
    }

    return { allowed: true, reason: null, statusCode: 200 };
  }

  /**
   * Check whether a feature is enabled for the repo's tier.
   *
   * @param tierOverride  Optional tier name to override env-based resolution (e.g. 'pro', 'team')
   */
  hasFeature(repoId: string, feature: string, tierOverride?: string): boolean {
    const tierConfig = getTierConfigForRepo(repoId, tierOverride);
    return tierConfig.features.includes(feature);
  }

  /**
   * Get the raw tier configuration for a repo.
   *
   * @param tierOverride  Optional tier name to override env-based resolution (e.g. 'pro', 'team')
   */
  getTierConfig(repoId: string, tierOverride?: string): TierConfig {
    return getTierConfigForRepo(repoId, tierOverride);
  }

  /**
   * Return usage records for a user (for API queries).
   */
  getUserUsage(userId: string): { yearMonth: string; fixCount: number }[] {
    const result = new Map<string, number>();
    for (const entry of this.monthlyCounters.values()) {
      if (entry.userId === userId) {
        result.set(entry.yearMonth, (result.get(entry.yearMonth) ?? 0) + entry.fixCount);
      }
    }
    return Array.from(result.entries())
      .map(([yearMonth, fixCount]) => ({ yearMonth, fixCount }))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }

  /**
   * Return usage records for a user + repo (for API queries).
   */
  getRepoUsage(userId: string, repoId: string): { yearMonth: string; fixCount: number }[] {
    const result: { yearMonth: string; fixCount: number }[] = [];
    for (const entry of this.monthlyCounters.values()) {
      if (entry.userId === userId && entry.repoId === repoId) {
        result.push({ yearMonth: entry.yearMonth, fixCount: entry.fixCount });
      }
    }
    return result.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }

  /**
   * Get the monthly fix count for a user + repo in the current month.
   */
  getCurrentMonthCount(userId: string, repoId: string): number {
    const yearMonth = currentYearMonth();
    const key = monthlyKey(userId, repoId, yearMonth);
    return this.monthlyCounters.get(key)?.fixCount ?? 0;
  }

  /** Close the underlying store (no-op for in-memory). */
  close(): void {
    this.records = [];
    this.monthlyCounters.clear();
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
function getTierConfigForRepo(repoId: string, tierOverride?: string): TierConfig {
  // If a specific tier is provided (e.g. from users.plan lookup), use it directly
  if (tierOverride) {
    return getTierConfig(tierOverride);
  }
  // Use process.env for the tier mapping.
  // In production with a hosted deployment, this would query a subscription
  // service. For self-hosted OSS, we read from the environment variable.
  const envTierOverride = process.env[`SYNTARO_TIER_${repoId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (envTierOverride) {
    return getTierConfig(envTierOverride);
  }

  // Fallback to the default tier from env
  const defaultTier = process.env.SYNTARO_DEFAULT_TIER ?? 'cloud-free';
  return getTierConfig(defaultTier);
}

/**
 * Calculate remaining fixes, capping at 0 for unlimited tiers.
 */
function calculateRemaining(limit: number, used: number): number {
  if (limit === UNLIMITED) return UNLIMITED;
  return Math.max(0, limit - used);
}
