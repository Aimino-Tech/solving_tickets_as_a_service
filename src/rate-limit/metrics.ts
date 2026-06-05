/**
 * Rate-limiting metrics collection.
 *
 * Provides lightweight counters for rate limit hits, concurrent fix runs,
 * and tier distribution. Designed to be consumed by Prometheus in production
 * or logged in development.
 *
 * In the current implementation these are in-memory counters. When a proper
 * metrics exporter (prom-client) is added, these will map directly to
 * Prometheus gauge/counter/histogram metrics.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ All counter operations are synchronous and infallible
 * ✅ Metrics are never fatal — always safe to call
 * ────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-limit-metrics' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitMetricsSnapshot {
  /** Total requests rate-limited since startup */
  rateLimited: number;
  /** Total requests allowed since startup */
  allowed: number;
  /** Current active fix runs per installation */
  activeFixes: Record<string, number>;
  /** Requests broken down by tier */
  byTier: Record<string, number>;
  /** Requests broken down by scope (account/repo/ip) */
  byScope: Record<string, number>;
}

// ---------------------------------------------------------------------------
// In-memory counters
// ---------------------------------------------------------------------------

class MetricsCollector {
  private rateLimited = 0;
  private allowed = 0;
  private readonly byTier: Record<string, number> = {};
  private readonly byScope: Record<string, number> = {};

  /** Increment the rate-limited counter. */
  incrementRateLimited(tier?: string, scope?: string): void {
    this.rateLimited++;
    if (tier) this.byTier[tier] = (this.byTier[tier] ?? 0) + 1;
    if (scope) this.byScope[scope] = (this.byScope[scope] ?? 0) + 1;
  }

  /** Increment the allowed counter. */
  incrementAllowed(tier?: string, scope?: string): void {
    this.allowed++;
    if (tier) this.byTier[tier] = (this.byTier[tier] ?? 0) + 1;
    if (scope) this.byScope[scope] = (this.byScope[scope] ?? 0) + 1;
  }

  /** Snapshot current metrics for export/logging. */
  snapshot(activeFixes?: Record<string, number>): RateLimitMetricsSnapshot {
    return {
      rateLimited: this.rateLimited,
      allowed: this.allowed,
      activeFixes: activeFixes ?? {},
      byTier: { ...this.byTier },
      byScope: { ...this.byScope },
    };
  }

  /** Log current metrics at info level. */
  logMetrics(activeFixes?: Record<string, number>): void {
    const snapshot = this.snapshot(activeFixes);
    log.info(snapshot, 'Rate limit metrics snapshot');
  }

  /** Reset all counters (useful for tests). */
  reset(): void {
    this.rateLimited = 0;
    this.allowed = 0;
    for (const key of Object.keys(this.byTier)) delete this.byTier[key];
    for (const key of Object.keys(this.byScope)) delete this.byScope[key];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!instance) {
    instance = new MetricsCollector();
  }
  return instance;
}

export function resetMetricsCollector(): void {
  instance = null;
}
