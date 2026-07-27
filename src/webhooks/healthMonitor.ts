/**
 * Webhook Health Monitor — periodic failure rate alerting + pipeline stall detection.
 *
 * Checks the webhook failure rate at a configurable interval.
 * If the failure rate exceeds 5% in the recent window, logs a
 * warning that can be routed to Slack or other alert channels.
 *
 * Also detects stalled pipeline runs that haven't been updated
 * within the stall threshold.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *   startHealthMonitor();  // Starts periodic checks
 *   stopHealthMonitor();   // Graceful shutdown
 * ────────────────────────────────────────────────────────────────────────
 */

import { webhookEventsRepository } from '../db/repositories/WebhookEventsRepository.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { dispatchAlert } from '../monitoring/alerting.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'webhook-health-monitor' });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 60_000;
const FAILURE_RATE_THRESHOLD = 5;
const PIPELINE_STALL_THRESHOLD_MINUTES = 30;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastAlertTriggered = false;
let lastStallAlertCount = 0;

// ---------------------------------------------------------------------------
// Pipeline Stall Detection
// ---------------------------------------------------------------------------

interface StalledPipeline {
  id: number;
  status: string;
  agentType: string;
  issueId: string;
  updatedAt: string;
  stalledMinutes: number;
}

/**
 * Check for stalled pipelines - active pipelines that haven't been updated
 * within the threshold. Dispatches an alert for each stalled pipeline found.
 */
async function checkForStalledPipelines(): Promise<void> {
  try {
    const result = await queryWithRetry<StalledPipeline>(
      `SELECT id, status, agent_type AS "agentType", issue_id AS "issueId", updated_at AS "updatedAt",
              EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 AS "stalledMinutes"
       FROM pipeline_runs
       WHERE status IN ('pending', 'running')
         AND updated_at < NOW() - ($1::int || ' minutes')::interval
       ORDER BY updated_at ASC`,
      [String(STALL_THRESHOLD_MINUTES)],
    );

    const stalled = result.rows;
    if (stalled.length === 0) {
      if (lastStallAlert.size > 0) {
        log.info('All stalled pipelines resolved');
        lastStallAlert.clear();
      }
      return;
    }

    const currentStalled = new Set(stalled.map((p) => String(p.id)));

    for (const pipeline of stalled) {
      const pipelineId = String(pipeline.id);
      if (lastStallAlert.has(pipelineId)) {
        log.debug({ pipelineId: pipeline.id, stalledMinutes: Math.round(pipeline.stalledMinutes) }, 'Pipeline still stalled (already alerted)');
        continue;
      }

      log.warn(
        { pipelineId: pipeline.id, status: pipeline.status, stalledMinutes: Math.round(pipeline.stalledMinutes), issueId: pipeline.issueId },
        `Stalled pipeline detected: ${pipeline.id} (${pipeline.status}) - no update for ${Math.round(pipeline.stalledMinutes)} minutes`,
      );

      dispatchAlert({
        severity: 'warning',
        rule: 'pipeline_stall_detected',
        message: `Pipeline ${pipeline.id} (${pipeline.agentType || 'unknown'}) for issue ${pipeline.issueId || 'unknown'} has been ${pipeline.status} with no update for ${Math.round(pipeline.stalledMinutes)} minutes`,
        context: {
          pipelineId: pipeline.id,
          status: pipeline.status,
          stalledMinutes: Math.round(pipeline.stalledMinutes),
          issueId: pipeline.issueId,
          agentType: pipeline.agentType,
        },
        timestamp: new Date().toISOString(),
      });
    }

    lastStallAlert = currentStalled;
  } catch (err) {
    log.error({ err: String(err) }, 'Pipeline stall detection check failed');
  }
}

// ---------------------------------------------------------------------------
// Health check types
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
        log.error(
          {
            failureRate: result.failureRate,
            threshold: result.threshold,
            counts: result.counts,
          },
          `[ALERT] Webhook failure rate ${result.failureRate}% exceeds ${result.threshold}% threshold - review dead letter queue`,
        );
        lastAlertTriggered = true;
      } else {
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

    // Also check for stalled pipeline runs
    await checkStalledPipelines();
  } catch (err) {
    log.error({ err: String(err) }, 'Webhook health check failed');
  }
}

export interface StallCheckResult {
  stalledCount: number;
  stalledRuns: Array<{ id: string; status: string; updatedAt: string; ageMinutes: number }>;
}

export async function checkStalledPipelines(): Promise<StallCheckResult> {
  try {
    const result = await queryWithRetry<any>(
      `SELECT id, status, updated_at
       FROM runs
       WHERE (status = 'running' OR status = 'queued')
         AND updated_at < NOW() - make_interval(mins => $1)
       ORDER BY updated_at ASC
       LIMIT 20`,
      [PIPELINE_STALL_THRESHOLD_MINUTES],
    );

    const stalled = (result.rows || []).map((row: any) => {
      const updatedAt = new Date(row.updated_at);
      const ageMinutes = Math.round((Date.now() - updatedAt.getTime()) / 60000);
      return { id: row.id, status: row.status, updatedAt: row.updated_at, ageMinutes };
    });

    const count = stalled.length;
    if (count > 0 && count !== lastStallAlertCount) {
      log.warn(
        { stalledCount: count, stalledRuns: stalled.map((r: any) => `${r.id} (${r.status}, ${r.ageMinutes}m)`) },
        `[ALERT] ${count} pipeline run(s) stalled for over ${PIPELINE_STALL_THRESHOLD_MINUTES} minutes`,
      );
      lastStallAlertCount = count;
    } else if (count === 0 && lastStallAlertCount > 0) {
      log.info('[RESOLVED] All stalled pipelines have recovered');
      lastStallAlertCount = 0;
    }

    return { stalledCount: count, stalledRuns: stalled };
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to check stalled pipelines');
    return { stalledCount: 0, stalledRuns: [] };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the periodic webhook health monitor.
 * Checks failure rate at the configured interval and logs alerts.
 * Also monitors pipeline stalls.
 */
export function startHealthMonitor(): void {
  if (intervalHandle) {
    log.warn('Webhook health monitor already running');
    return;
  }

  log.info({ checkIntervalMs: CHECK_INTERVAL_MS, threshold: FAILURE_RATE_THRESHOLD, stallThresholdMinutes: STALL_THRESHOLD_MINUTES }, 'Starting webhook health monitor');

  runHealthCheck().catch((err) => {
    log.error({ err: String(err) }, 'Initial webhook health check failed');
  });
  runStallCheck().catch((err) => {
    log.error({ err: String(err) }, 'Initial pipeline stall check failed');
  });

  intervalHandle = setInterval(() => {
    runHealthCheck().catch((err) => {
      log.error({ err: String(err) }, 'Webhook health monitor tick failed');
    });
    runStallCheck().catch((err) => {
      log.error({ err: String(err) }, 'Pipeline stall detection tick failed');
    });
  }, CHECK_INTERVAL_MS);

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
    lastStallAlert.clear();
    log.info('Webhook health monitor stopped');
  }
}
