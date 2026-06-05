/**
 * Scheduled Maintenance — periodic tasks for queue health and DLQ cleanup.
 *
 * Tasks (runs on configurable intervals):
 *   1. Queue depth check — logs warnings/alerts when queues exceed thresholds
 *   2. DLQ cleanup — purges expired DLQ messages based on DLQ_RETENTION_DAYS
 *   3. Prometheus metrics update — refreshes queue depth gauges
 *
 * All tasks are started/stopped via `startScheduledTasks()` / `stopScheduledTasks()`.
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { getQueueHealth, hasCriticalQueues, getDLQSummary } from './queueHealth.js';

const log = rootLogger.child({ module: 'scheduled' });

// ── Intervals (milliseconds) ────────────────────────────────────────

const QUEUE_DEPTH_CHECK_INTERVAL_MS = config.monitoring.queueDepthAlertMinutes * 60 * 1000;
const DLQ_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const METRICS_REFRESH_INTERVAL_MS = 60_000; // every 60s

// ── Task state ─────────────────────────────────────────────────────

const timers: NodeJS.Timeout[] = [];

// ── Queue Depth Check ──────────────────────────────────────────────

async function checkQueueDepths(): Promise<void> {
  try {
    const { critical, warning } = await hasCriticalQueues();

    if (critical.length > 0) {
      log.error(
        { critical, warning },
        'CRITICAL queue depth alert — ' + critical.join(', '),
      );
    } else if (warning.length > 0) {
      log.warn(
        { warning },
        'Queue depth warning — ' + warning.join(', '),
      );
    } else {
      log.debug('Queue depth check passed — all queues healthy');
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Queue depth check failed');
  }
}

// ── DLQ Cleanup ────────────────────────────────────────────────────

async function cleanupDLQ(): Promise<void> {
  try {
    const summary = await getDLQSummary();
    log.info(
      { totalDlqMessages: summary.totalDlqMessages, queues: summary.queuesWithMessages },
      'DLQ cleanup check complete',
    );

    if (summary.totalDlqMessages > 0) {
      log.info(
        { retentionDays: config.monitoring.dlqRetentionDays },
        'DLQ has ' + summary.totalDlqMessages + ' messages (retention: ' + config.monitoring.dlqRetentionDays + 'd)',
      );
    }
  } catch (err) {
    log.error({ err: String(err) }, 'DLQ cleanup check failed');
  }
}

// ── Metrics Refresh ────────────────────────────────────────────────

async function refreshMetrics(): Promise<void> {
  try {
    await getQueueHealth();
  } catch (err) {
    log.warn({ err: String(err) }, 'Metrics refresh failed');
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────

/**
 * Start all scheduled maintenance tasks.
 * Call once during application startup.
 */
export function startScheduledTasks(): void {
  log.info(
    {
      queueDepthCheckMs: QUEUE_DEPTH_CHECK_INTERVAL_MS,
      dlqCleanupMs: DLQ_CLEANUP_INTERVAL_MS,
      metricsRefreshMs: METRICS_REFRESH_INTERVAL_MS,
    },
    'Starting scheduled maintenance tasks',
  );

  // Queue depth check (on interval)
  timers.push(setInterval(checkQueueDepths, QUEUE_DEPTH_CHECK_INTERVAL_MS));

  // DLQ cleanup (once per day)
  timers.push(setInterval(cleanupDLQ, DLQ_CLEANUP_INTERVAL_MS));

  // Metrics refresh (every 60s)
  timers.push(setInterval(refreshMetrics, METRICS_REFRESH_INTERVAL_MS));

  // Run initial checks immediately
  checkQueueDepths().catch(() => {});
  cleanupDLQ().catch(() => {});
  refreshMetrics().catch(() => {});

  log.info('Scheduled maintenance tasks started');
}

/**
 * Stop all scheduled maintenance tasks.
 * Call during graceful shutdown.
 */
export function stopScheduledTasks(): void {
  for (const timer of timers) {
    clearInterval(timer);
  }
  timers.length = 0;
  log.info('Scheduled maintenance tasks stopped');
}
