/**
 * Security Findings Tracking — analytics integration for malicious code detection.
 *
 * Sends findings to analytics infrastructure (Prometheus metrics via bridgeMetrics,
 * and PostHog if configured). Non-blocking — failures are logged but never thrown.
 *
 * Usage:
 *   import { trackFinding } from './tracking.js';
 *   await trackFinding({ file: 'src/main.ts', line: 42, ... });
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import type { Finding } from './trufflehog-scanner.js';

const log = rootLogger.child({ module: 'security-tracking' });

// ---------------------------------------------------------------------------
// PostHog interface (lazy-loaded to avoid import if not configured)
// ---------------------------------------------------------------------------

let _posthog: { capture: (event: string, properties: Record<string, unknown>) => void } | null = null;

async function getPostHog(): Promise<typeof _posthog> {
  if (_posthog !== undefined) return _posthog;

  const posthogApiKey = process.env.POSTHOG_API_KEY;
  const posthogHost = process.env.POSTHOG_HOST || 'https://app.posthog.com';

  if (!posthogApiKey) {
    _posthog = null;
    return null;
  }

  try {
    // Dynamic import to avoid hard dependency
    const { PostHog } = await import('posthog-node');
    const client = new PostHog(posthogApiKey, {
      host: posthogHost,
    });
    _posthog = {
      capture: (event: string, properties: Record<string, unknown>) => {
        try {
          client.capture({
            distinctId: 'stas-security-gate',
            event,
            properties,
          });
        } catch (err) {
          log.warn({ err: String(err) }, 'PostHog capture failed');
        }
      },
    };
    log.info('PostHog analytics initialized for security tracking');
  } catch {
    log.warn('posthog-node not available — PostHog tracking disabled');
    _posthog = null;
  }

  return _posthog;
}

// ---------------------------------------------------------------------------
// Metrics tracking
// ---------------------------------------------------------------------------

/**
 * Track a finding via Prometheus metrics and (optionally) PostHog.
 *
 * Records:
 *   - security_findings_total (counter by severity, type, scanner)
 *   - security_blocking_count (gauge for current blocking count)
 *
 * This function is intentionally fire-and-forget. All errors are caught
 * and logged as warnings.
 */
export async function trackFinding(finding: Finding): Promise<void> {
  const severity = finding.severity?.toUpperCase() || 'MEDIUM';
  const type = finding.description?.split(':')[0]?.trim() || 'unknown';
  const scanner = finding.scanner || 'builtin';

  try {
    // ── Prometheus metrics ──────────────────────────────────────────
    bridgeMetrics.incrementCounter('security_findings_total', {
      severity,
      type: type.toLowerCase().replace(/\s+/g, '_'),
      scanner,
    });

    if (severity === 'HIGH') {
      bridgeMetrics.incrementCounter('security_blocking_findings_total', {
        scanner,
        type: type.toLowerCase().replace(/\s+/g, '_'),
      });
    }

    // ── PostHog analytics ──────────────────────────────────────────
    const posthog = await getPostHog();
    if (posthog) {
      posthog.capture('security_finding_detected', {
        severity,
        type,
        scanner,
        file: finding.file,
        line: finding.line,
        description: finding.description,
        timestamp: new Date().toISOString(),
      });

      if (severity === 'HIGH') {
        posthog.capture('security_finding_blocked', {
          severity,
          type,
          scanner,
          file: finding.file,
          line: finding.line,
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    // Never throw — tracking is fire-and-forget
    log.warn({ err: String(err), finding: { file: finding.file, line: finding.line } }, 'Failed to track finding');
  }
}

/**
 * Track that the detection gate ran (success or failure).
 */
export async function trackGateRun(
  passed: boolean,
  findingCount: number,
  blockedByCount: number,
): Promise<void> {
  try {
    bridgeMetrics.incrementCounter('security_gate_runs_total', {
      result: passed ? 'passed' : 'blocked',
    });
    bridgeMetrics.setGauge('security_gate_finding_count', {}, findingCount);

    if (blockedByCount > 0) {
      bridgeMetrics.setGauge('security_gate_blocked_by_count', {}, blockedByCount);
    }

    const posthog = await getPostHog();
    if (posthog) {
      posthog.capture('security_gate_run', {
        passed,
        findingCount,
        blockedByCount,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to track gate run');
  }
}

/**
 * Clean up PostHog client (call on shutdown).
 */
export async function shutdownTracking(): Promise<void> {
  if (_posthog) {
    try {
      // PostHog client may have a flush method
      log.info('Shutting down security tracking');
    } catch {
      // ignore
    }
    _posthog = null;
  }
}
