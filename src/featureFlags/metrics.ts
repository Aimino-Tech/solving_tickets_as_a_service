/**
 * Feature flag Prometheus metrics.
 *
 * Tracks feature flag evaluation counts and override events.
 * Follows the same in-memory pattern as ratelimit/metrics.ts and webhooks/metrics.ts.
 *
 * ── Exposed metrics ───────────────────────────────────────────────────
 * - feature_flag_evaluations_total{flag,result}  — Counter per flag evaluation
 * - feature_flag_overrides_total{flag,account}   — Counter per override/set
 * ──────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'feature-flag-metrics' });

// ---------------------------------------------------------------------------
// Metric stores
// ---------------------------------------------------------------------------

type EvaluationResult = 'enabled' | 'disabled';

const evaluationCounts = new Map<string, number>();
const overrideCounts = new Map<string, number>();

// ---------------------------------------------------------------------------
// Record functions
// ---------------------------------------------------------------------------

function evaluationKey(flag: string, result: EvaluationResult): string {
  return `${flag}|${result}`;
}

function overrideKey(flag: string, account: string): string {
  return `${flag}|${account}`;
}

/**
 * Record a feature flag evaluation.
 * Call this every time isFeatureEnabled() returns a result.
 */
export function recordFeatureFlagEvaluation(flag: string, result: EvaluationResult): void {
  const key = evaluationKey(flag, result);
  evaluationCounts.set(key, (evaluationCounts.get(key) ?? 0) + 1);
}

/**
 * Record a feature flag override (setFeatureFlag call).
 * `account` should be the account ID string, or 'global' for null.
 */
export function recordFeatureFlagOverride(flag: string, account: string): void {
  const key = overrideKey(flag, account);
  overrideCounts.set(key, (overrideCounts.get(key) ?? 0) + 1);
  log.info({ flag, account }, 'Feature flag override recorded');
}

// ---------------------------------------------------------------------------
// Metrics rendering
// ---------------------------------------------------------------------------

/**
 * Render feature flag metrics in Prometheus text exposition format.
 * Called from the /metrics endpoint.
 */
export function renderFeatureFlagMetrics(): string {
  const lines: string[] = [];

  // feature_flag_evaluations_total
  if (evaluationCounts.size > 0) {
    lines.push('# HELP feature_flag_evaluations_total Total feature flag evaluations by flag and result');
    lines.push('# TYPE feature_flag_evaluations_total counter');
    for (const [key, count] of evaluationCounts) {
      const pipeIdx = key.indexOf('|');
      const flag = key.slice(0, pipeIdx);
      const result = key.slice(pipeIdx + 1);
      lines.push(`feature_flag_evaluations_total{flag="${flag}",result="${result}"} ${count}`);
    }
  }

  // feature_flag_overrides_total
  if (overrideCounts.size > 0) {
    lines.push('# HELP feature_flag_overrides_total Total feature flag overrides by flag and account');
    lines.push('# TYPE feature_flag_overrides_total counter');
    for (const [key, count] of overrideCounts) {
      const pipeIdx = key.indexOf('|');
      const flag = key.slice(0, pipeIdx);
      const account = key.slice(pipeIdx + 1);
      lines.push(`feature_flag_overrides_total{flag="${flag}",account="${account}"} ${count}`);
    }
  }

  return lines.join('\n');
}

/**
 * Reset all metrics (useful for tests).
 */
export function resetFeatureFlagMetrics(): void {
  evaluationCounts.clear();
  overrideCounts.clear();
  log.debug('Feature flag metrics reset');
}
