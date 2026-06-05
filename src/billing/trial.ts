/**
 * Free trial management for STAS billing.
 *
 * Every new account gets a 14-day free trial with 5 fix runs.
 * During the trial period, accounts have access to Solo plan features.
 * After the trial ends (or trial fix limit is reached), the account
 * must subscribe to a paid plan to continue using the service.
 *
 * ── Design ────────────────────────────────────────────────────────────────────
 * Trial state is stored in the `accounts` database table:
 *   - trial_start: TIMESTAMPTZ — when the trial began
 *   - trial_end: TIMESTAMPTZ — when the trial ends (or ended)
 *
 * Trial usage is tracked in Redis (same as billing usage) using the
 * account ID with a special trial usage key prefix.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';
import { PLANS } from './plans.js';
import type { PlanId } from './plans.js';

const log = rootLogger.child({ module: 'billing-trial' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrialStatus {
  /** Whether the account is currently in a trial period. */
  isActive: boolean;
  /** When the trial started (ISO string). */
  startedAt: string | null;
  /** When the trial ends (ISO string). */
  endsAt: string | null;
  /** Days remaining in the trial (0 if not active). */
  daysRemaining: number;
  /** Fixes used during the trial. */
  fixesUsed: number;
  /** Maximum fixes allowed during trial. */
  fixLimit: number;
  /** Whether the trial fix limit has been reached. */
  fixLimitReached: boolean;
}

// ---------------------------------------------------------------------------
// Redis helpers for trial usage tracking
// ---------------------------------------------------------------------------

let trialRedis: Redis | null = null;

function getTrialRedisClient(): Redis {
  if (!trialRedis) {
    trialRedis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    trialRedis.on('error', (err) => {
      log.error({ err: String(err) }, 'Trial Redis connection error');
    });
  }
  return trialRedis;
}

function buildTrialKey(accountId: number): string {
  return `stas:billing:trial:${accountId}`;
}

/**
 * Get the number of fixes used during the trial.
 */
export async function getTrialUsage(accountId: number): Promise<number> {
  try {
    const client = getTrialRedisClient();
    const key = buildTrialKey(accountId);
    return await client.zcard(key);
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to get trial usage — returning 0');
    return 0;
  }
}

/**
 * Increment trial usage counter.
 */
export async function incrementTrialUsage(accountId: number): Promise<void> {
  try {
    const client = getTrialRedisClient();
    const key = buildTrialKey(accountId);
    const now = Date.now();
    const member = `${now}:${crypto.randomUUID()}`;

    const pipeline = client.pipeline();
    pipeline.zadd(key, now, member);
    // Trial data is valid for up to 60 days
    pipeline.expire(key, 60 * 24 * 60 * 60);
    await pipeline.exec();
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to increment trial usage');
  }
}

/**
 * Reset trial usage for an account.
 */
export async function resetTrialUsage(accountId: number): Promise<void> {
  try {
    const client = getTrialRedisClient();
    const key = buildTrialKey(accountId);
    await client.del(key);
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to reset trial usage');
  }
}

// ---------------------------------------------------------------------------
// Trial lifecycle
// ---------------------------------------------------------------------------

/**
 * Start a trial for an account. Sets trial_start and trial_end in the database.
 * Idempotent — if a trial is already active, returns the existing trial dates.
 *
 * @param accountId - Internal STAS account ID
 * @param trialDays - Trial duration in days (default: 14)
 *
 * @returns The trial start and end dates
 */
export async function startTrial(
  accountId: number,
  trialDays = 14,
): Promise<{ trialStart: Date; trialEnd: Date }> {
  // Check if trial already exists
  const existing = await queryWithRetry<{
    trial_start: Date | null;
    trial_end: Date | null;
  }>(
    'SELECT trial_start, trial_end FROM accounts WHERE id = $1',
    [accountId],
  );

  const existingTrial = existing.rows[0];
  if (existingTrial?.trial_start && existingTrial?.trial_end) {
    // Trial already active — return existing dates
    const now = new Date();
    if (new Date(existingTrial.trial_end) > now) {
      log.info({ accountId, trialEnd: existingTrial.trial_end }, 'Trial already active');
      return {
        trialStart: existingTrial.trial_start,
        trialEnd: existingTrial.trial_end,
      };
    }
  }

  // Start a new trial
  const trialStart = new Date();
  const trialEnd = new Date(trialStart.getTime() + trialDays * 24 * 60 * 60 * 1000);

  await queryWithRetry(
    `UPDATE accounts
     SET trial_start = $1, trial_end = $2, updated_at = NOW()
     WHERE id = $3`,
    [trialStart.toISOString(), trialEnd.toISOString(), accountId],
  );

  log.info(
    { accountId, trialDays, trialStart: trialStart.toISOString(), trialEnd: trialEnd.toISOString() },
    'Trial started',
  );

  return { trialStart, trialEnd };
}

/**
 * Get the trial status for an account.
 */
export async function getTrialStatus(accountId: number): Promise<TrialStatus> {
  try {
    const result = await queryWithRetry<{
      trial_start: Date | null;
      trial_end: Date | null;
    }>(
      'SELECT trial_start, trial_end FROM accounts WHERE id = $1',
      [accountId],
    );

    const row = result.rows[0];
    if (!row?.trial_start || !row?.trial_end) {
      return {
        isActive: false,
        startedAt: null,
        endsAt: null,
        daysRemaining: 0,
        fixesUsed: 0,
        fixLimit: 0,
        fixLimitReached: false,
      };
    }

    const now = new Date();
    const trialEnd = new Date(row.trial_end);
    const isActive = trialEnd > now;

    const diffMs = trialEnd.getTime() - now.getTime();
    const daysRemaining = isActive ? Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24))) : 0;

    const fixesUsed = await getTrialUsage(accountId);
    const fixLimit = PLANS.solo.trialFixLimit;

    return {
      isActive,
      startedAt: row.trial_start?.toISOString() ?? null,
      endsAt: row.trial_end?.toISOString() ?? null,
      daysRemaining,
      fixesUsed,
      fixLimit,
      fixLimitReached: fixesUsed >= fixLimit,
    };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to get trial status');
    return {
      isActive: false,
      startedAt: null,
      endsAt: null,
      daysRemaining: 0,
      fixesUsed: 0,
      fixLimit: 0,
      fixLimitReached: false,
    };
  }
}

/**
 * Check if an account can use the service based on trial status.
 * Returns true if:
 *   - The trial is active AND the fix limit hasn't been reached, OR
 *   - The account has an active paid subscription
 *
 * This is a pre-flight check called before enqueuing a fix job.
 */
export async function canUseTrial(
  accountId: number,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const status = await getTrialStatus(accountId);

    if (!status.isActive) {
      return {
        allowed: false,
        reason: 'Your free trial has ended. Please subscribe to continue using STAS.',
      };
    }

    if (status.fixLimitReached) {
      return {
        allowed: false,
        reason: `You have used all ${status.fixLimit} trial fixes. Please subscribe for unlimited fixes.`,
      };
    }

    return { allowed: true };
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to check trial eligibility');
    return { allowed: false, reason: 'Unable to verify trial status. Please try again.' };
  }
}

/**
 * End (expire) a trial immediately.
 */
export async function expireTrial(accountId: number): Promise<void> {
  await queryWithRetry(
    `UPDATE accounts
     SET trial_end = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [accountId],
  );
  log.info({ accountId }, 'Trial expired');
}
