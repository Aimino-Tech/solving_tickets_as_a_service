/**
 * Alerting rules and notification dispatch.
 *
 * Defines structured alert severity levels and threshold-based rules for
 * monitoring key system health indicators. Integrates with Sentry for
 * error tracking and can be extended to push to Slack, PagerDuty, etc.
 *
 * Alert Levels:
 *   critical — Immediate attention required (page on-call)
 *   warning  — Needs investigation soon (notify Slack)
 *   info     — Informational (dashboard / log)
 *
 * ── Alerting Rules ──────────────────────────────────────────────────
 * Critical:
 *   - queue_depth > 50 for 5+ minutes
 *   - worker_crash_loop (3+ crashes in 5 minutes)
 *   - db_connection_failure
 *
 * Warning:
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

const log = rootLogger.child({ module: 'alerting' });

// ── Types ───────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertEvent {
  severity: AlertSeverity;
  rule: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

// ── Alert Dispatch ──────────────────────────────────────────────────

/**
 * Dispatch an alert to all configured channels.
 *
 * Currently logs to console + Sentry breadcrumbs. In production this
 * would also push to Slack, PagerDuty, or webhook endpoints.
 */
export function dispatchAlert(alert: AlertEvent): void {
  const { severity, rule, message, context } = alert;

  // Always log
  const logFn = severity === 'critical' ? log.error : severity === 'warning' ? log.warn : log.info;
  logFn({ rule, message, ...(context || {}) }, `[${severity.toUpperCase()}] ${rule}: ${message}`);

  // Add Sentry breadcrumb for error correlation
  addBreadcrumb(`alert.${severity}`, `[${severity}] ${rule}: ${message}`, context);

  // For critical alerts, capture as a Sentry event
  if (severity === 'critical') {
    captureError(new Error(`[CRITICAL] ${rule}: ${message}`), context);
  }
}

// ── Alerting Rules ──────────────────────────────────────────────────

/**
 * Check queue depth against configured thresholds and alert if exceeded.
 * Called periodically by the scheduled health check task.
 */
export function checkQueueDepth(queueDepth: number, durationMinutes: number): void {
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
  } else if (queueDepth > warnThreshold) {
    dispatchAlert({
      severity: 'warning',
      rule: 'queue_depth_warning',
      message: `Queue depth ${queueDepth} exceeds warning threshold ${warnThreshold}`,
      context: { queueDepth, threshold: warnThreshold },
      timestamp: new Date().toISOString(),
    });
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
 * Alert on webhook signature verification failures.
 * These could indicate misconfiguration or malicious requests.
 */
export function reportWebhookVerificationFailure(source: string, detail: string): void {
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
export function reportRateLimitHit(source: string, remaining: number, limit: number): void {
  dispatchAlert({
    severity: 'warning',
    rule: 'rate_limit_hit',
    message: `${source} rate limit approaching: ${remaining}/${limit} remaining`,
    context: { source, remaining, limit },
    timestamp: new Date().toISOString(),
  });
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
export function reportNewAccountSignup(installationId: number, accountLogin: string): void {
  dispatchAlert({
    severity: 'info',
    rule: 'new_account_signup',
    message: `New GitHub App installation: ${accountLogin} (ID: ${installationId})`,
    context: { installationId, accountLogin },
    timestamp: new Date().toISOString(),
  });
}
