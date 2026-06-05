/**
 * Prometheus-style metrics counters for rate limiting and concurrency.
 *
 * Since STAS doesn't currently have a Prometheus client dependency, this
 * module exposes simple counter objects that can be:
 *   a) logged periodically
 *   b) exposed via a /metrics endpoint later
 *   c) swapped for real prom-client when added
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ All counters are plain objects — no errors possible
 * ✅ Thread-safe for Node.js single-threaded event loop
 * ────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-limit-metrics' });

/** Counter type supporting increment and reset. */
export interface Counter {
  name: string;
  help: string;
  inc(labels?: Record<string, string | number>): void;
  reset(): void;
  get(): number;
}

/**
 * Simple in-memory counter with optional label dimensions.
 * In production, replace this with prom-client Counter/Gauge.
 */
class SimpleCounter implements Counter {
  name: string;
  help: string;
  private counters: Map<string, number> = new Map();
  private defaultLabels: Record<string, string | number>;

  constructor(name: string, help: string, defaultLabels: Record<string, string | number> = {}) {
    this.name = name;
    this.help = help;
    this.defaultLabels = defaultLabels;
  }

  inc(labels: Record<string, string | number> = {}): void {
    const merged = { ...this.defaultLabels, ...labels };
    const key = this.serializeLabels(merged);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  reset(): void {
    this.counters.clear();
  }

  get(): number {
    let total = 0;
    for (const val of this.counters.values()) {
      total += val;
    }
    return total;
  }

  /** Return all label-keyed counts for inspection. */
  dump(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, val] of this.counters.entries()) {
      result[key] = val;
    }
    return result;
  }

  private serializeLabels(labels: Record<string, string | number>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }
}

// ── Rate limit counters ──────────────────────────────────────────────

/** Requests blocked by rate limiting, by layer. */
export const rateLimitBlocked = new SimpleCounter(
  'stas_rate_limit_blocked_total',
  'Total requests blocked by rate limiting',
);

/** Requests allowed through rate limiting. */
export const rateLimitAllowed = new SimpleCounter(
  'stas_rate_limit_allowed_total',
  'Total requests allowed by rate limiting',
);

// ── Concurrency counters ─────────────────────────────────────────────

/** Concurrency slots acquired. */
export const concurrencyAcquired = new SimpleCounter(
  'stas_concurrency_acquired_total',
  'Total concurrency slots acquired',
);

/** Concurrency slots released. */
export const concurrencyReleased = new SimpleCounter(
  'stas_concurrency_released_total',
  'Total concurrency slots released',
);

/** Concurrency slot acquisitions denied (account at limit). */
export const concurrencyDenied = new SimpleCounter(
  'stas_concurrency_denied_total',
  'Total concurrency slot acquisitions denied',
);

/** Active concurrency slots (gauge-like, track via inc/dec). */
export const concurrencyActive = new SimpleCounter(
  'stas_concurrency_active',
  'Current active concurrency slots',
);

// ── Logging helper ───────────────────────────────────────────────────

/**
 * Log all current metrics at info level.
 * Call this periodically (e.g., every 60s via setInterval) or expose via
 * a /metrics endpoint.
 */
export function logMetrics(): void {
  log.info({
    rateLimitBlocked: rateLimitBlocked.get(),
    rateLimitAllowed: rateLimitAllowed.get(),
    concurrencyAcquired: concurrencyAcquired.get(),
    concurrencyReleased: concurrencyReleased.get(),
    concurrencyDenied: concurrencyDenied.get(),
    concurrencyActive: concurrencyActive.get(),
  }, 'Rate limit metrics snapshot');
}

/**
 * Reset all counters (useful in tests).
 */
export function resetAllMetrics(): void {
  rateLimitBlocked.reset();
  rateLimitAllowed.reset();
  concurrencyAcquired.reset();
  concurrencyReleased.reset();
  concurrencyDenied.reset();
  concurrencyActive.reset();
}
