/**
 * Webhook Health Monitor — periodic failure rate alerting.
 *
 * Checks the webhook failure rate at a configurable interval.
 * If the failure rate exceeds 5% in the recent window, logs a
 * warning that can be routed to Slack or other alert channels.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *   startHealthMonitor();  // Starts periodic checks
 *   stopHealthMonitor();   // Graceful shutdown
 * ────────────────────────────────────────────────────────────────────────
 */

import { webhookEventsRepository } from '../db/repositories/WebhookEventsRepository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'webhook-health-monitor' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
const FAILURE_RATE_THRESHOLD = 5; // Alert if > 5% failure rate

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Track previous alert state to avoid repeated alert spam
let lastAlertTriggered = false;

// ---------------------------------------------------------------------------
// Health check logic
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  status: 'healthy' | 'degraded';
  failureRate: number;
  threshold: number;
  alertTriggered: boolean;
  counts: {
    processed: number;
    failed: number;
    dead: number;
    received: number;
    processing: number;
  };
}

/**
 * Perform a health check against the webhook_events table.
 * Computes the failure rate and returns a structured result.
 */
export async function checkWebhookHealth(): Promise<HealthCheckResult> {
  const totalProcessed = await webhookEventsRepository.countByStatus('processed');
  const totalFailed = await webhookEventsRepository.countByStatus('failed');
  const totalDead = await webhookEventsRepository.countByStatus('dead');
  const totalReceived = await webhookEventsRepository.countByStatus('received');
  const totalProcessing = await webhookEventsRepository.countByStatus('processing');

  const totalResolved = totalProcessed + totalFailed + totalDead;
  const failureRate = totalResolved > 0
    ? ((totalFailed + totalDead) / totalResolved) * 100
    : 0;

  const alertTriggered = failureRate > FAILURE_RATE_THRESHOLD;

  return {
    status: alertTriggered ? 'degraded' : 'healthy',
    failureRate: Math.round(failureRate * 100) / 100,
    threshold: FAILURE_RATE_THRESHOLD,
    alertTriggered,
    counts: {
      processed: totalProcessed,
      failed: totalFailed,
      dead: totalDead,
      received: totalReceived,
      processing: totalProcessing,
    },
  };
}

/**
 * Run a single health check and log an alert if failure rate exceeds threshold.
 */
async function runHealthCheck(): Promise<void> {
  try {
    const result = await checkWebhookHealth();

    if (result.alertTriggered) {
      if (!lastAlertTriggered) {
        // First time alerting — log prominently
        log.error(
          {
            failureRate: result.failureRate,
            threshold: result.threshold,
            counts: result.counts,
          },
          `[ALERT] Webhook failure rate ${result.failureRate}% exceeds ${result.threshold}% threshold — review dead letter queue`,
        );
        lastAlertTriggered = true;
      } else {
        // Ongoing alert — log at warn level to avoid spam
        log.warn(
          { failureRate: result.failureRate, counts: result.counts },
          'Webhook failure rate still elevated',
        );
      }
    } else {
      if (lastAlertTriggered) {
        log.info(
          { failureRate: result.failureRate },
          '[RESOLVED] Webhook failure rate returned to normal',
        );
      }
      lastAlertTriggered = false;
      log.debug({ failureRate: result.failureRate }, 'Webhook health check passed');
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Webhook health check failed');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic webhook health monitor.
 * Checks failure rate at the configured interval and logs alerts.
 */
export function startHealthMonitor(): void {
  if (intervalHandle) {
    log.warn('Webhook health monitor already running');
    return;
  }

  log.info({ checkIntervalMs: CHECK_INTERVAL_MS, threshold: FAILURE_RATE_THRESHOLD }, 'Starting webhook health monitor');

  // Run an initial check
  runHealthCheck().catch((err) => {
    log.error({ err: String(err) }, 'Initial webhook health check failed');
  });

  intervalHandle = setInterval(() => {
    runHealthCheck().catch((err) => {
      log.error({ err: String(err) }, 'Webhook health monitor tick failed');
    });
  }, CHECK_INTERVAL_MS);

  // Allow process to exit even if interval is running
  if (intervalHandle && typeof intervalHandle === 'object' && 'unref' in intervalHandle) {
    intervalHandle.unref();
  }

  log.info('Webhook health monitor started');
}

/**
 * Stop the periodic webhook health monitor.
 */
export function stopHealthMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    lastAlertTriggered = false;
    log.info('Webhook health monitor stopped');
  }
}
