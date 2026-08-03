/**
 * Cross-Service Bridge — Prometheus Metrics
 *
 * Lightweight in-memory metrics collector that exposes Prometheus-format
 * text for scraping. No external dependency — implements the subset of
 * prom-client needed by the bridge.
 *
 * Metrics:
 *   - messages_published_total   (counter, tags: queue)
 *   - messages_consumed_total    (counter, tags: queue)
 *   - messages_failed_total      (counter, tags: queue, error)
 *   - consumer_lag               (gauge, tags: queue)
 *   - processing_duration_seconds (histogram, tags: queue)
 *   - syntaro_governance_failures_total (counter, tags: repo, error)
 */

import { EventEmitter } from 'node:events';

// ── Metric Types ──────────────────────────────────────────────────

interface MetricLabel {
  name: string;
  value: string;
}

interface MetricSample {
  labels: MetricLabel[];
  value: number;
}

interface CounterMetric {
  type: 'counter';
  help: string;
  name: string;
  samples: MetricSample[];
}

interface GaugeMetric {
  type: 'gauge';
  help: string;
  name: string;
  samples: MetricSample[];
}

interface HistogramBucket {
  le: number;
  cumulativeCount: number;
}

interface HistogramMetric {
  type: 'histogram';
  help: string;
  name: string;
  buckets: HistogramBucket[];
  samples: Map<string, number>; // labels key -> count
  sum: number;
  count: number;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

// ── Label Helpers ─────────────────────────────────────────────────

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}`;
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ── Default Histogram Buckets (seconds) ───────────────────────────

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// ── BridgeMetrics ─────────────────────────────────────────────────

/**
 * Collects Prometheus-format metrics for the cross-service bridge.
 * Emits 'metric' events when values change for real-time monitoring.
 */
export class BridgeMetrics {
  private readonly counters = new Map<string, CounterMetric>();
  private readonly gauges = new Map<string, GaugeMetric>();
  private readonly histograms = new Map<string, HistogramMetric>();
  private readonly emitter = new EventEmitter();

  /**
   * Event emitter for real-time metric notifications.
   * Events:
   *   - 'update' (metricName: string, value: number, labels: Record<string, string>)
   */
  get events(): EventEmitter {
    return this.emitter;
  }

  // ── Counters ────────────────────────────────────────────────────

  /**
   * Increment a counter metric.
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = { type: 'counter', help: name, name, samples: [] };
      this.counters.set(name, counter);
    }

    const key = labelKey(labels);
    const existing = counter.samples.find(
      (s) => labelKey(Object.fromEntries(s.labels.map((l) => [l.name, l.value]))) === key,
    );

    if (existing) {
      existing.value += value;
    } else {
      counter.samples.push({
        labels: Object.entries(labels).map(([name, value]) => ({ name, value })),
        value,
      });
    }

    this.emitter.emit('update', name, value, labels);
  }

  // ── Gauges ──────────────────────────────────────────────────────

  /**
   * Set a gauge metric to an absolute value.
   */
  setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = { type: 'gauge', help: name, name, samples: [] };
      this.gauges.set(name, gauge);
    }

    const key = labelKey(labels);
    const existing = gauge.samples.find(
      (s) => labelKey(Object.fromEntries(s.labels.map((l) => [l.name, l.value]))) === key,
    );

    if (existing) {
      existing.value = value;
    } else {
      gauge.samples.push({
        labels: Object.entries(labels).map(([name, value]) => ({ name, value })),
        value,
      });
    }

    this.emitter.emit('update', name, value, labels);
  }

  /**
   * Increment a gauge metric.
   */
  incrementGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = labelKey(labels);
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = { type: 'gauge', help: name, name, samples: [] };
      this.gauges.set(name, gauge);
    }

    const existing = gauge.samples.find(
      (s) => labelKey(Object.fromEntries(s.labels.map((l) => [l.name, l.value]))) === key,
    );

    if (existing) {
      existing.value += value;
    } else {
      gauge.samples.push({
        labels: Object.entries(labels).map(([name, value]) => ({ name, value })),
        value,
      });
    }

    this.emitter.emit('update', name, value, labels);
  }

  /**
   * Decrement a gauge metric.
   */
  decrementGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    this.incrementGauge(name, labels, -value);
  }

  // ── Histograms ──────────────────────────────────────────────────

  /**
   * Observe a duration value (in seconds) for a histogram metric.
   */
  observeHistogram(
    name: string,
    labels: Record<string, string> = {},
    valueSeconds: number,
    buckets: number[] = DEFAULT_BUCKETS,
  ): void {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = {
        type: 'histogram',
        help: name,
        name,
        buckets: buckets.map((le) => ({ le, cumulativeCount: 0 })),
        samples: new Map(),
        sum: 0,
        count: 0,
      };
      this.histograms.set(name, histogram);
    }

    histogram.sum += valueSeconds;
    histogram.count++;

    // Increment buckets that this value falls into
    for (const bucket of histogram.buckets) {
      if (valueSeconds <= bucket.le) {
        bucket.cumulativeCount++;
      }
    }

    this.emitter.emit('update', name, valueSeconds, labels);
  }

  // ── Prometheus Exposition Format ────────────────────────────────

  /**
   * Render all metrics in Prometheus text exposition format.
   * Suitable for serving at a /metrics HTTP endpoint.
   */
  render(): string {
    const lines: string[] = [];

    // Counters
    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const sample of counter.samples) {
        const labels = Object.fromEntries(sample.labels.map((l) => [l.name, l.value]));
        lines.push(`${counter.name}${formatLabels(labels)} ${sample.value}`);
      }
    }

    // Gauges
    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      for (const sample of gauge.samples) {
        const labels = Object.fromEntries(sample.labels.map((l) => [l.name, l.value]));
        lines.push(`${gauge.name}${formatLabels(labels)} ${sample.value}`);
      }
    }

    // Histograms
    for (const histogram of this.histograms.values()) {
      const baseName = histogram.name;
      lines.push(`# HELP ${baseName} ${histogram.help}`);
      lines.push(`# TYPE ${baseName} histogram`);

      // _count
      lines.push(`${baseName}_count ${histogram.count}`);

      // _sum
      lines.push(`${baseName}_sum ${histogram.sum}`);

      // _bucket{le="..."}
      for (const bucket of histogram.buckets) {
        lines.push(`${baseName}_bucket{le="${bucket.le}"} ${bucket.cumulativeCount}`);
      }

      // +Inf bucket
      lines.push(`${baseName}_bucket{le="+Inf"} ${histogram.count}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Reset all metrics (useful for tests).
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────

/**
 * Global bridge metrics instance. Import and use directly.
 */
export const bridgeMetrics = new BridgeMetrics();

/**
 * Record a successful message publication.
 */
export function recordMessagePublished(queue: string): void {
  bridgeMetrics.incrementCounter('messages_published_total', { queue });
}

/**
 * Record a consumed message.
 */
export function recordMessageConsumed(queue: string): void {
  bridgeMetrics.incrementCounter('messages_consumed_total', { queue });
}

/**
 * Record a failed message.
 */
export function recordMessageFailed(queue: string, error: string): void {
  bridgeMetrics.incrementCounter('messages_failed_total', { queue, error });
}

/**
 * Set consumer lag (number of unprocessed messages).
 */
export function recordConsumerLag(queue: string, lag: number): void {
  bridgeMetrics.setGauge('consumer_lag', { queue }, lag);
}

/**
 * Record a processing duration in seconds.
 */
export function recordProcessingDuration(queue: string, durationSeconds: number): void {
  bridgeMetrics.observeHistogram('processing_duration_seconds', { queue }, durationSeconds);
}

/**
 * Record the current depth of a queue (number of pending messages).
 */
export function recordQueueDepth(queue: string, depth: number): void {
  bridgeMetrics.setGauge('queue_depth', { queue }, depth);
}

/**
 * Record a publish error with the specific error type.
 */
export function recordPublishError(queue: string, errorType: string): void {
  bridgeMetrics.incrementCounter('publish_errors_total', { queue, error: errorType });
  // Also record under the general failed metric for consistency
  recordMessageFailed(queue, errorType);
}

/**
 * Record a governance proxy failure with repo context.
 * Counter: syntaro_governance_failures_total
 */
export function recordGovernanceFailure(repo: string, error: string): void {
  bridgeMetrics.incrementCounter('syntaro_governance_failures_total', { repo, error });
}
