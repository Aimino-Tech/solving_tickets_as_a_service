/**
 * Audit log for tier and quota configuration changes.
 *
 * Records all admin actions (tier overrides, quota resets, feature toggles)
 * in a Redis-backed append-only log. Each entry is stored as a JSON string
 * in a Redis list keyed by `syntaro:audit:log`.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * - Entries are appended to a Redis list (LPUSH) so most recent entries are
 *   at the head.
 * - The list is capped at 10,000 entries to avoid unbounded growth.
 * - Redis failures are non-fatal — audit entries are dropped silently.
 * - Entries can be retrieved via the admin API for review.
 * ────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pricing-audit' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_KEY = 'syntaro:audit:log';
const MAX_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** Unique entry ID (UUID v4). */
  id: string;
  /** ISO-8601 timestamp of the action. */
  timestamp: string;
  /** Actor who performed the action (admin key label, system, etc.). */
  actor: string;
  /** Action type. */
  action: AuditAction;
  /** Target of the action (account ID, tier name, etc.). */
  target: string;
  /** Details / context for the action. */
  details: Record<string, unknown>;
}

export type AuditAction =
  | 'tier.override.set'
  | 'tier.override.cleared'
  | 'quota.reset'
  | 'quota.reset.all'
  | 'tier.config.updated';

// ---------------------------------------------------------------------------
// Redis client
// ---------------------------------------------------------------------------

let auditRedis: Redis | null = null;

function getAuditRedisClient(): Redis {
  if (!auditRedis) {
    auditRedis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Audit Redis retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });

    auditRedis.on('error', (err) => {
      log.error({ err: String(err) }, 'Audit Redis connection error');
    });
  }
  return auditRedis;
}

/**
 * Close the shared audit Redis client.
 */
export async function closeAuditRedisClient(): Promise<void> {
  if (auditRedis) {
    try {
      await auditRedis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing audit Redis client');
    }
    auditRedis = null;
  }
}

// ---------------------------------------------------------------------------
// Audit operations
// ---------------------------------------------------------------------------

/**
 * Record an audit entry.
 *
 * This is a best-effort operation — failures are logged but not propagated.
 */
export async function recordAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
  try {
    const client = getAuditRedisClient();
    const fullEntry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const pipeline = client.pipeline();
    pipeline.lpush(AUDIT_KEY, JSON.stringify(fullEntry));
    pipeline.ltrim(AUDIT_KEY, 0, MAX_ENTRIES - 1);
    await pipeline.exec();

    log.debug({ action: entry.action, target: entry.target }, 'Audit entry recorded');
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to record audit entry');
  }
}

/**
 * Record a tier override change.
 */
export async function auditTierOverrideSet(actor: string, accountId: number, tier: string): Promise<void> {
  await recordAuditEntry({
    actor,
    action: 'tier.override.set',
    target: String(accountId),
    details: { tier },
  });
}

/**
 * Record a tier override clearance.
 */
export async function auditTierOverrideCleared(actor: string, accountId: number, previousTier: string): Promise<void> {
  await recordAuditEntry({
    actor,
    action: 'tier.override.cleared',
    target: String(accountId),
    details: { previousTier },
  });
}

/**
 * Record a single-account quota reset.
 */
export async function auditQuotaReset(actor: string, accountId: number): Promise<void> {
  await recordAuditEntry({
    actor,
    action: 'quota.reset',
    target: String(accountId),
    details: {},
  });
}

/**
 * Record a global quota reset (monthly cron).
 */
export async function auditQuotaResetAll(actor: string): Promise<void> {
  await recordAuditEntry({
    actor,
    action: 'quota.reset.all',
    target: 'all',
    details: {},
  });
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Get the most recent audit entries.
 *
 * @param limit - Maximum number of entries to return (default: 100).
 * @returns Array of audit entries, most recent first.
 */
export async function getAuditLog(limit: number = 100): Promise<AuditEntry[]> {
  try {
    const client = getAuditRedisClient();
    const entries = await client.lrange(AUDIT_KEY, 0, limit - 1);
    return entries
      .map((entry) => {
        try {
          return JSON.parse(entry) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to retrieve audit log');
    return [];
  }
}
