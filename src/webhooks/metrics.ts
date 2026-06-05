/**
 * Webhook metrics — lightweight in-memory counters for monitoring.
 *
 * Tracks webhook volume, processing status, and latency.
 * Since prom-client is not a dependency, this uses a simple
 * in-memory store with a /metrics endpoint serialization.
 *
 * ── Exposed metrics ────────────────────────────────────────────────────
 * - webhooks_received_total{source}        — Count by source
 * - webhooks_processed_total{status}       — Count by final status
 * - webhook_processing_duration_ms{source} — Histogram buckets
 * ────────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'webhook-metrics' });

// ---------------------------------------------------------------------------
// Metric stores
// ---------------------------------------------------------------------------

const receivedBySource = new Map<string, number>();
const processedByStatus = new Map<string, number>();
const durationBuckets = new Map<string, number[]>();

const BUCKET_BOUNDARIES = [100, 500, 1000, 5000, 10000, 30000, 60000];

// ---------------------------------------------------------------------------
// Record functions
// ---------------------------------------------------------------------------

/**
 * Record that a webhook was received from a given source.
 */
export function recordWebhookReceived(source: string): void {
  receivedBySource.set(source, (receivedBySource.get(source) ?? 0) + 1);
}

/**
 * Record that a webhook was processed with a given status.
 */
export function recordWebhookProcessed(status: string): void {
  processedByStatus.set(status, (processedByStatus.get(status) ?? 0) + 1);
}

/**
 * Record webhook processing duration in milliseconds.
 * Assigns to the appropriate histogram bucket.
 */
export function recordWebhookDuration(source: string, durationMs: number): void {
  if (!durationBuckets.has(source)) {
    durationBuckets.set(source, new Array(BUCKET_BOUNDARIES.length + 1).fill(0));
  }
  const buckets = durationBuckets.get(source)!;
  for (let i = 0; i < BUCKET_BOUNDARIES.length; i++) {
    if (durationMs <= BUCKET_BOUNDARIES[i]) {
      buckets[i]++;
      break;
    }
  }
  // If it exceeds all boundaries, put it in the last bucket
  if (durationMs > BUCKET_BOUNDARIES[BUCKET_BOUNDARIES.length - 1]) {
    buckets[BUCKET_BOUNDARIES.length]++;
  }
}

// ---------------------------------------------------------------------------
// Metrics endpoint serialization
// ---------------------------------------------------------------------------

/**
 * Render all metrics in Prometheus text format.
 */
export function renderMetrics(): string {
  const lines: string[] = [];

  // webhooks_received_total
  for (const [source, count] of receivedBySource) {
    lines.push(`# HELP webhooks_received_total Total webhooks received by source`);
    lines.push(`# TYPE webhooks_received_total counter`);
    lines.push(`webhooks_received_total{source="${source}"} ${count}`);
  }

  // webhooks_processed_total
  for (const [status, count] of processedByStatus) {
    lines.push(`# HELP webhooks_processed_total Total webhooks processed by status`);
    lines.push(`# TYPE webhooks_processed_total counter`);
    lines.push(`webhooks_processed_total{status="${status}"} ${count}`);
  }

  // webhook_processing_duration_ms (as a pseudo-histogram via bucket labels)
  lines.push(`# HELP webhook_processing_duration_ms Webhook processing duration in milliseconds`);
  lines.push(`# TYPE webhook_processing_duration_ms histogram`);
  for (const [source, buckets] of durationBuckets) {
    for (let i = 0; i < BUCKET_BOUNDARIES.length; i++) {
      lines.push(
        `webhook_processing_duration_ms_bucket{source="${source}",le="${BUCKET_BOUNDARIES[i]}"} ${buckets[i] ?? 0}`,
      );
    }
    lines.push(
      `webhook_processing_duration_ms_bucket{source="${source}",le="+Inf"} ${buckets[BUCKET_BOUNDARIES.length] ?? 0}`,
    );
  }

  return lines.join('\n');
}

/**
 * Reset all metrics (useful for tests).
 */
export function resetMetrics(): void {
  receivedBySource.clear();
  processedByStatus.clear();
  durationBuckets.clear();
  log.debug('Webhook metrics reset');
}
