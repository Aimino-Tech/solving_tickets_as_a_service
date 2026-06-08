/**
 * Rate limit Prometheus metrics.
 *
 * Exposes metrics for monitoring rate limit hit rates and block rates
 * across all route groups, enabling alerting on abuse patterns.
 *
 * ── Exposed metrics ──────────────────────────────────────────────────────
 * - ratelimit_requests_total{route,status}     — Total requests by route & outcome
 * - ratelimit_blocks_total{route,scope,key}    — Total blocked requests
 * - ratelimit_current_count{route,scope,key}   — Current in-flight count per scope
 * ──────────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'ratelimit-metrics' });

// ---------------------------------------------------------------------------
// In-memory metric stores
// ---------------------------------------------------------------------------

interface RateLimitMetricLabels {
  route: string;
  status: 'allowed' | 'blocked';
  auth?: 'authenticated' | 'unauthenticated';
  scope?: string;
}

const requestCounts = new Map<string, number>();

function labelsKey(labels: RateLimitMetricLabels): string {
  return `${labels.route}|${labels.status}|${labels.auth ?? ''}|${labels.scope ?? ''}`;
}

// ---------------------------------------------------------------------------
// Record functions
// ---------------------------------------------------------------------------

/**
 * Record a rate limit decision for a request.
 */
export function recordRateLimitDecision(
  route: string,
  status: 'allowed' | 'blocked',
  auth?: 'authenticated' | 'unauthenticated',
  scope?: string,
): void {
  const key = labelsKey({ route, status, auth, scope });
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
}

/**
 * Record a rate limit block event (convenience wrapper).
 */
export function recordRateLimitBlock(
  route: string,
  scope?: string,
  key?: string,
): void {
  recordRateLimitDecision(route, 'blocked', undefined, scope);
  log.warn(
    { route, scope, key },
    'Rate limit block recorded',
  );
}

/**
 * Record a rate limit allowance (convenience wrapper).
 */
export function recordRateLimitAllow(
  route: string,
  auth?: 'authenticated' | 'unauthenticated',
): void {
  recordRateLimitDecision(route, 'allowed', auth);
}

// ---------------------------------------------------------------------------
// Metrics rendering
// ---------------------------------------------------------------------------

/**
 * Render rate limit metrics in Prometheus text exposition format.
 * Called from the /metrics endpoint.
 */
export function renderRateLimitMetrics(): string {
  const lines: string[] = [];

  // ratelimit_requests_total
  lines.push(`# HELP ratelimit_requests_total Total requests assessed by rate limiter`);
  lines.push(`# TYPE ratelimit_requests_total counter`);
  for (const [key, count] of requestCounts) {
    const [route, status, auth, scope] = key.split('|');
    const labels: string[] = [`route="${route}"`, `status="${status}"`];
    if (auth) labels.push(`auth="${auth}"`);
    if (scope) labels.push(`scope="${scope}"`);
    lines.push(`ratelimit_requests_total{${labels.join(',')}} ${count}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Reset all metrics (useful for tests).
 */
export function resetRateLimitMetrics(): void {
  requestCounts.clear();
  log.debug('Rate limit metrics reset');
}
