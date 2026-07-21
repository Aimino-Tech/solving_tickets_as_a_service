/**
 * Alerting rules and notification dispatch.
 *
 * Defines structured alert severity levels and threshold-based rules for
 * monitoring key system health indicators. Integrates with Sentry for
 * error tracking and can push to Slack, email, PagerDuty, etc.
 *
 * Alert Levels:
 *   critical — Immediate attention required (page on-call)
 *   warning  — Needs investigation soon (notify Slack)
 *   info     — Informational (dashboard / log)
 *
 * ── Alerting Rules (AIM-1272) ─────────────────────────────────────────
 * Critical:
 *   - queue_depth > 200 for 5+ minutes → Slack alert
 *   - error_rate > 20% over 5min → Slack alert
 *   - worker_down > 2min → Slack + email alert
 *   - failed_webhook_delivery > 5 in 1h → Slack alert
 *   - slo_breach (any SLI) → Slack alert
 *
 * Warning:
 *   - queue_depth > 50 for 5+ minutes → Slack alert
 *   - error_rate > 5% over 5min → Slack alert
 *   - worker_no_heartbeat > 2min → Slack alert
 *   - webhook_verification_failure
 *   - retry_attempt (any job retry)
 *   - rate_limit_hit (approaching GitHub API limits)
 *
 * Info:
 *   - fix_run_success
 *   - new_account_signup
 * ────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { addBreadcrumb, captureError } from './sentry.js';
import { generateSLOReport, recordSLIMetrics } from './slos.js';
import type { SLIName } from './slos.js';

const log = rootLogger.child({ module: 'alerting' });

// ── Types ───────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertChannel = 'slack' | 'email' | 'both';

export interface AlertEvent {
  severity: AlertSeverity;
  rule: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
  channel?: AlertChannel;
  escalated?: boolean;
}

// ── Alert Dispatch via n8n ──────────────────────────────────────────

/**
 * Forward an alert event to the n8n monitoring webhook.
 * n8n handles formatting (severity-colored Slack blocks) and delivery.
 */
async function sendToN8nWebhook(alert: AlertEvent): Promise<void> {
  const webhookUrl = config.alerting.n8nWebhookUrl;
  if (!webhookUrl) {
    log.warn('N8N_MONITORING_WEBHOOK_URL not configured — skipping n8n alert dispatch');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        severity: alert.severity,
        rule: alert.rule,
        message: alert.message,
        context: alert.context ?? {},
        timestamp: alert.timestamp,
        channel: config.alerting.slackChannel || '#syntaro-alerts',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      log.error(
        { status: response.status, body },
        'n8n alert webhook delivery failed',
      );
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to send alert to n8n webhook');
  }
}

/**
 * Dispatch an alert to the n8n webhook. n8n handles formatting,
 * severity-colored Slack blocks, and delivery to the correct channel.
 */
export async function dispatchAlert(alert: AlertEvent): Promise<void> {
  const { severity, rule, message, context } = alert;

  // Always log
  const logMsg = `[${severity.toUpperCase()}] ${rule}: ${message}`;
  const logCtx = { rule, message, ...(context || {}) };
  if (severity === 'critical') log.error(logCtx, logMsg);
  else if (severity === 'warning') log.warn(logCtx, logMsg);
  else log.info(logCtx, logMsg);

  // Add Sentry breadcrumb for error correlation
  addBreadcrumb(
    `alert.${severity}`,
    `[${severity}] ${rule}: ${message}`,
    context,
  );

  // For critical alerts, capture as a Sentry event
  if (severity === 'critical') {
    captureError(new Error(`[CRITICAL] ${rule}: ${message}`), context);
  }

  // Forward to n8n for Slack delivery (handles formatting, retry, channel routing)
  await sendToN8nWebhook(alert).catch((err) =>
    log.error({ err: String(err) }, 'n8n dispatch failed'),
  );
}

// ── Alerting Rules ──────────────────────────────────────────────────

/**
 * Check queue depth against configured thresholds and alert if exceeded.
 * Called periodically by the scheduled health check task.
 *
 * Rule (AIM-1272): queue_depth > 200 for 5+ min → critical Slack alert
 *                   queue_depth > 50  for 5+ min → warning Slack alert
 */
export function checkQueueDepth(
  queueDepth: number,
  durationMinutes: number,
): void {
  const critThreshold = config.alerting.critQueueDepth;
  const warnThreshold = config.alerting.warnQueueDepth;

  if (queueDepth > critThreshold && durationMinutes >= 5) {
    dispatchAlert({
      severity: 'critical',
      rule: 'queue_depth_critical',
      message: `Queue depth ${queueDepth} exceeds critical threshold ${critThreshold} for ${durationMinutes}+ minutes`,
      context: { queueDepth, durationMinutes, threshold: critThreshold },
      timestamp: new Date().toISOString(),
    });
  } else if (queueDepth > warnThreshold && durationMinutes >= 5) {
    dispatchAlert({
      severity: 'warning',
      rule: 'queue_depth_warning',
      message: `Queue depth ${queueDepth} exceeds warning threshold ${warnThreshold} for ${durationMinutes}+ minutes`,
      context: { queueDepth, durationMinutes, threshold: warnThreshold },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Check error rate against the configured threshold.
 *
 * Rule (AIM-1272): error_rate > 20% over 5min → critical Slack alert
 *                   error_rate > 5%  over 5min → warning Slack alert
 */
export function checkErrorRate(
  errorRatePercent: number,
  windowMinutes: number,
): void {
  const warnThreshold = config.alerting.warnErrorRatePercent;
  const critThreshold = config.alerting.critErrorRatePercent;

  if (errorRatePercent > critThreshold && windowMinutes >= 5) {
    dispatchAlert({
      severity: 'critical',
      rule: 'error_rate_critical',
      message: `Error rate ${errorRatePercent.toFixed(1)}% exceeds critical threshold ${critThreshold}% over ${windowMinutes} min window`,
      context: { errorRatePercent, windowMinutes, threshold: critThreshold },
      timestamp: new Date().toISOString(),
    });
  } else if (errorRatePercent > warnThreshold && windowMinutes >= 5) {
    dispatchAlert({
      severity: 'warning',
      rule: 'error_rate_warning',
      message: `Error rate ${errorRatePercent.toFixed(1)}% exceeds warning threshold ${warnThreshold}% over ${windowMinutes} min window`,
      context: { errorRatePercent, windowMinutes, threshold: warnThreshold },
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Worker Heartbeat Tracking (AIM-1272) ────────────────────────────

/**
 * In-memory store for worker heartbeat timestamps.
 * Maps workerId → Unix timestamp (ms) of last heartbeat.
 * In production, this would be backed by Redis for multi-process accuracy.
 */
const workerHeartbeats = new Map<string, number>();

/**
 * Record a heartbeat from a worker process.
 * Call this periodically (every 30-60s) from the worker's main loop.
 *
 * @param workerId - Unique identifier for the worker (e.g., hostname:pid)
 */
export function recordWorkerHeartbeat(workerId: string): void {
  const now = Date.now();
  workerHeartbeats.set(workerId, now);
  log.debug({ workerId }, 'Worker heartbeat recorded');
}

/**
 * Remove a worker from the heartbeat tracker (e.g., on graceful shutdown).
 */
export function removeWorkerHeartbeat(workerId: string): void {
  workerHeartbeats.delete(workerId);
  log.info({ workerId }, 'Worker heartbeat entry removed');
}

/**
 * Check all tracked worker heartbeats and alert on any that have not
 * reported within the configured threshold.
 *
 * Rule (AIM-1272): no heartbeat for >2min → warning Slack alert
 *                   no heartbeat for >2min → critical Slack + email alert
 *
 * @param maxSilenceSeconds - Maximum allowed seconds without a heartbeat (default: 120)
 */
export function checkWorkerHeartbeats(maxSilenceSeconds: number = 120): void {
  const now = Date.now();
  const thresholdMs = maxSilenceSeconds * 1000;

  for (const [workerId, lastHeartbeat] of workerHeartbeats.entries()) {
    const elapsed = now - lastHeartbeat;
    if (elapsed > thresholdMs) {
      const downSeconds = Math.floor(elapsed / 1000);
      reportWorkerDown(workerId, downSeconds);
    }
  }
}

/**
 * Get a snapshot of current worker heartbeat status.
 * Used by health endpoints and dashboard.
 */
export function getWorkerHeartbeatStatus(): Array<{
  workerId: string;
  lastHeartbeat: string;
  isAlive: boolean;
  secondsSinceHeartbeat: number;
}> {
  const now = Date.now();
  const results: Array<{
    workerId: string;
    lastHeartbeat: string;
    isAlive: boolean;
    secondsSinceHeartbeat: number;
  }> = [];

  for (const [workerId, lastHeartbeat] of workerHeartbeats.entries()) {
    const elapsed = now - lastHeartbeat;
    results.push({
      workerId,
      lastHeartbeat: new Date(lastHeartbeat).toISOString(),
      isAlive: elapsed < 120_000, // 2 minutes
      secondsSinceHeartbeat: Math.floor(elapsed / 1000),
    });
  }

  return results;
}

/**
 * Alert when a worker has been down for more than 2 minutes.
 *
 * Rule (AIM-1272): worker_down > 2min → Slack + email alert
 */
export function reportWorkerDown(
  workerId: string,
  downDurationSeconds: number,
): void {
  if (downDurationSeconds < 120) return; // Only alert after 2 minutes

  const minutes = (downDurationSeconds / 60).toFixed(1);
  dispatchAlert({
    severity: 'critical',
    rule: 'worker_down',
    message: `Worker "${workerId}" has been down for ${minutes} minutes`,
    context: { workerId, downDurationSeconds, downDurationMinutes: minutes },
    timestamp: new Date().toISOString(),
    channel: 'both', // Slack + email for worker downtime
  });
}

// ── SLO Compliance Check (AIM-1272) ─────────────────────────────────

/**
 * Generate an SLO report and fire alerts for any breached SLIs.
 * Also records SLI metrics to Prometheus.
 *
 * Called periodically by the scheduled health check task.
 */
export async function checkSLOCompliance(): Promise<void> {
  try {
    const report = await generateSLOReport();

    // Record metrics to Prometheus
    recordSLIMetrics(report);

    // Alert on breached SLIs
    for (const sli of report.slis) {
      if (sli.status === 'breached') {
        reportSLOBreach(sli.name, sli.currentValue, sli.target);
      } else if (sli.status === 'warning') {
        dispatchAlert({
          severity: 'warning',
          rule: `slo_warning_${sli.name}`,
          message: `SLO at risk for ${sli.name}: current=${sli.currentValue}, target=${sli.target} (${sli.unit})`,
          context: {
            sliName: sli.name,
            currentValue: sli.currentValue,
            target: sli.target,
            unit: sli.unit,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    log.info(
      {
        overallStatus: report.overallStatus,
        compliant: report.compliant,
        warning: report.warning,
        breached: report.breached,
      },
      'SLO compliance check complete',
    );
  } catch (err) {
    log.error({ err: String(err) }, 'SLO compliance check failed');
  }
}

// ── Additional Alerting Rules ───────────────────────────────────────

/**
 * Alert when failed webhook deliveries exceed the threshold in a rolling hour.
 *
 * Rule: failed_webhook_delivery > 5 in 1h → Slack alert
 */
export function reportFailedWebhookDelivery(
  source: string,
  deliveryId: string | undefined,
  errorDetail: string,
  failureCount1h: number,
): void {
  const threshold = 5;
  if (failureCount1h > threshold) {
    dispatchAlert({
      severity: 'critical',
      rule: 'failed_webhook_delivery',
      message: `Failed webhook delivery: ${source} (${deliveryId ?? 'unknown'}) — ${failureCount1h} failures in the last hour (threshold: ${threshold})`,
      context: {
        source,
        deliveryId,
        errorDetail,
        failureCount1h,
        threshold,
      },
      timestamp: new Date().toISOString(),
    });
  } else {
    // Log individual failures even if below threshold
    log.warn(
      { source, deliveryId, errorDetail, failureCount1h },
      `Webhook delivery failed (${failureCount1h}/${threshold} in 1h)`,
    );
  }
}

/**
 * Alert on worker crash loop detection.
 * Call this with the count of worker crashes in the last 5 minutes.
 */
export function checkWorkerCrashLoop(crashCount5min: number): void {
  if (crashCount5min >= 3) {
    dispatchAlert({
      severity: 'critical',
      rule: 'worker_crash_loop',
      message: `${crashCount5min} worker crashes in the last 5 minutes — possible crash loop`,
      context: { crashCount5min, windowMinutes: 5 },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Alert on database connection failures.
 */
export function reportDbConnectionFailure(error: string): void {
  dispatchAlert({
    severity: 'critical',
    rule: 'db_connection_failure',
    message: `Database connection failed: ${error}`,
    context: { error },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Report an SLO breach for a given SLI.
 */
export function reportSLOBreach(sliName: string, currentValue: number, target: number): void {
  dispatchAlert({
    severity: 'critical',
    rule: `slo_breach_${sliName}`,
    message: `SLO breached for ${sliName}: current=${currentValue}, target=${target}`,
    context: { sliName, currentValue, target },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Alert on webhook signature verification failures.
 */
export function reportWebhookVerificationFailure(
  source: string,
  detail: string,
): void {
  dispatchAlert({
    severity: 'warning',
    rule: 'webhook_verification_failure',
    message: `Webhook verification failed for ${source}: ${detail}`,
    context: { source, detail },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Report a retry attempt (job being re-processed after failure).
 */
export function reportRetryAttempt(
  jobId: string | undefined,
  repo: string,
  issueNumber: number,
  attempt: number,
  error: string,
): void {
  dispatchAlert({
    severity: 'warning',
    rule: 'retry_attempt',
    message: `Retry #${attempt} for ${repo}#${issueNumber}: ${error}`,
    context: { jobId, repo, issueNumber, attempt, error },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Report a rate limit hit (approaching or hitting GitHub API limits).
 */
export function reportRateLimitHit(
  source: string,
  remaining: number,
  limit: number,
): void {
  dispatchAlert({
    severity: 'warning',
    rule: 'rate_limit_hit',
    message: `${source} rate limit approaching: ${remaining}/${limit} remaining`,
    context: { source, remaining, limit },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Check error rate for a feature flag and alert if it exceeds thresholds.
 *
 * Rule: if error_rate > threshold for a flagged feature → Slack alert
 *
 * @param flag - The feature flag name
 * @param errorRatePercent - Current error rate percentage for this feature
 * @param windowMinutes - The time window over which the rate was calculated
 * @param totalRequests - Total requests in the window (for context)
 */
export function checkFeatureFlagErrorRate(
  flag: string,
  errorRatePercent: number,
  windowMinutes: number,
  totalRequests?: number,
): void {
  const warnThreshold = config.alerting.warnErrorRatePercent;
  const critThreshold = config.alerting.critErrorRatePercent;

  const context: Record<string, unknown> = {
    flag,
    errorRatePercent,
    windowMinutes,
    threshold: warnThreshold,
    totalRequests,
  };

  if (errorRatePercent > critThreshold && windowMinutes >= 5) {
    dispatchAlert({
      severity: 'critical',
      rule: `feature_flag_error_rate_critical_${flag}`,
      message: `Feature flag "${flag}" error rate ${errorRatePercent.toFixed(1)}% exceeds critical threshold ${critThreshold}% over ${windowMinutes} min window (total requests: ${totalRequests ?? 'unknown'})`,
      context,
      timestamp: new Date().toISOString(),
    });
  } else if (errorRatePercent > warnThreshold && windowMinutes >= 5) {
    dispatchAlert({
      severity: 'warning',
      rule: `feature_flag_error_rate_warning_${flag}`,
      message: `Feature flag "${flag}" error rate ${errorRatePercent.toFixed(1)}% exceeds warning threshold ${warnThreshold}% over ${windowMinutes} min window (total requests: ${totalRequests ?? 'unknown'})`,
      context,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Report a successful fix run.
 */
export function reportFixRunSuccess(
  repo: string,
  issueNumber: number,
  prUrl?: string,
): void {
  dispatchAlert({
    severity: 'info',
    rule: 'fix_run_success',
    message: `Fix completed for ${repo}#${issueNumber}${prUrl ? ` — ${prUrl}` : ''}`,
    context: { repo, issueNumber, prUrl },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Report a new account signup (GitHub App installation).
 */
export function reportNewAccountSignup(
  installationId: number,
  accountLogin: string,
): void {
  dispatchAlert({
    severity: 'info',
    rule: 'new_account_signup',
    message: `New GitHub App installation: ${accountLogin} (ID: ${installationId})`,
    context: { installationId, accountLogin },
    timestamp: new Date().toISOString(),
  });
}
