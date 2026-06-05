/**
 * Scheduled jobs for pricing tier maintenance.
 *
 * ── Monthly Quota Reset ─────────────────────────────────────────────────────
 * A cron job that resets all account monthly fix quotas at the start of each
 * billing period (1st of the month at 00:00 UTC). This uses a simple
 * setInterval-based scheduler that checks every hour whether a new month has
 * started.
 *
 * In a production deployment with multiple workers, use an external scheduler
 * (e.g., node-cron, BullMQ repeatable jobs, or a separate cron service) to
 * ensure exactly-once execution. The current implementation is safe for
 * single-instance deployments.
 *
 * ── No Rollover ─────────────────────────────────────────────────────────────
 * Unused fixes from the previous month do NOT roll over. The reset is a hard
 * reset — all counters are deleted and each account's quota is refilled to
 * their tier's full monthly limit.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { resetMonthlyQuotas } from './quota.js';
import { auditQuotaResetAll } from './audit.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pricing-cron' });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cronInterval: ReturnType<typeof setInterval> | null = null;
let lastResetMonth: number | null = null;

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start the monthly quota reset scheduler.
 *
 * Checks every hour whether the month has changed. When a new month is
 * detected, triggers a global quota reset.
 *
 * Call this during application startup for single-instance deployments.
 * For multi-instance deployments, use an external scheduler instead.
 */
export function startMonthlyResetCron(): void {
  if (cronInterval) {
    log.warn('Monthly reset cron is already running');
    return;
  }

  // Record the current month so we don't reset immediately on start
  lastResetMonth = getCurrentMonth();

  log.info({ startMonth: lastResetMonth }, 'Monthly reset cron started (checks every hour)');

  cronInterval = setInterval(async () => {
    const currentMonth = getCurrentMonth();

    if (currentMonth !== lastResetMonth) {
      log.info(
        { previousMonth: lastResetMonth, currentMonth },
        'New month detected — resetting all quotas',
      );

      try {
        await resetMonthlyQuotas();
        await auditQuotaResetAll('system:cron');

        log.info({ month: currentMonth }, 'Monthly quota reset completed');
      } catch (err) {
        log.error({ err: String(err), month: currentMonth }, 'Monthly quota reset failed');
      }

      lastResetMonth = currentMonth;
    }
  }, 60 * 60 * 1000); // Check every hour
}

/**
 * Stop the monthly reset cron.
 */
export function stopMonthlyResetCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    log.info('Monthly reset cron stopped');
  }
}

// ---------------------------------------------------------------------------
// Manual trigger
// ---------------------------------------------------------------------------

/**
 * Manually trigger a monthly quota reset.
 *
 * Useful for testing or when an admin needs to force a reset outside the
 * normal schedule. Records an audit entry.
 */
export async function triggerMonthlyReset(): Promise<{ resetCount: number }> {
  log.info('Manual monthly quota reset triggered');

  try {
    await resetMonthlyQuotas();
    await auditQuotaResetAll('system:manual');

    log.info('Manual monthly quota reset completed');
    return { resetCount: 0 };
  } catch (err) {
    log.error({ err: String(err) }, 'Manual monthly quota reset failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current month as a number (0 = January, 11 = December).
 * Used for detecting month transitions.
 */
function getCurrentMonth(): number {
  return new Date().getUTCMonth();
}

/**
 * Check whether the cron is currently running.
 */
export function isCronRunning(): boolean {
  return cronInterval !== null;
}
