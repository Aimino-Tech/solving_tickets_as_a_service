/**
 * Tenant Health Scoring — per-tenant health evaluation.
 *
 * Computes a composite health score (0–100) for each tenant based on:
 *   - Fix rate (successful fixes / total attempts, weighted 30%)
 *   - Error rate (failed operations / total operations, weighted 25%)
 *   - Queue depth (pending items vs capacity, weighted 20%)
 *   - Latency profile (p50/p95/p99 vs targets, weighted 25%)
 *
 * Consumers can call computeTenantHealth() for a single tenant snapshot or
 * computeAllTenantHealth() for a dashboard overview. Each call returns a
 * TenantHealthReport with per-metric breakdown and an overall composite score.
 *
 * This module is stateless — metric sources are injected via the MetricCollector
 * interface so it works with Prometheus, Datadog, or in-memory stores.
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'tenant-health' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface FixRateMetrics {
  totalFixes: number;
  successfulFixes: number;
}

export interface ErrorRateMetrics {
  totalOperations: number;
  failedOperations: number;
}

export interface QueueDepthMetrics {
  currentDepth: number;
  capacity: number;
}

export interface LatencyMetrics {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  targetP50Ms: number;
  targetP95Ms: number;
  targetP99Ms: number;
}

export interface MetricScore {
  value: number;
  score: number; // 0–100
  weight: number; // contribution weight (0–1)
  status: HealthStatus;
}

export interface TenantHealthScore {
  tenantId: string;
  timestamp: string;
  compositeScore: number; // 0–100 weighted average
  status: HealthStatus;
  metrics: {
    fixRate: MetricScore;
    errorRate: MetricScore;
    queueDepth: MetricScore;
    latency: MetricScore;
  };
}

export interface TenantHealthReport {
  score: TenantHealthScore;
  suggestions: string[];
}

/**
 * Collector abstraction so callers can supply metrics from any backend
 * (Prometheus, Datadog, in-memory store, etc.).
 */
export interface MetricCollector {
  getFixRate(tenantId: string): Promise<FixRateMetrics>;
  getErrorRate(tenantId: string): Promise<ErrorRateMetrics>;
  getQueueDepth(tenantId: string): Promise<QueueDepthMetrics>;
  getLatency(tenantId: string): Promise<LatencyMetrics>;
  getKnownTenants(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Default thresholds
// ---------------------------------------------------------------------------

export const DEFAULT_WEIGHTS = {
  fixRate: 0.30,
  errorRate: 0.25,
  queueDepth: 0.20,
  latency: 0.25,
} as const;

export const THRESHOLDS = {
  fixRate: { healthy: 90, degraded: 70 }, // percent
  errorRate: { healthy: 5, degraded: 15 }, // percent
  queueUtilization: { healthy: 0.6, degraded: 0.85 }, // ratio
  latencyMultiplier: { healthy: 1.0, degraded: 1.5 }, // times target
} as const;

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function healthStatusForScore(score: number): HealthStatus {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'degraded';
  return 'unhealthy';
}

/**
 * Score fix rate: 100 at or above healthy threshold, linear down to 0.
 */
function scoreFixRate(metrics: FixRateMetrics): Omit<MetricScore, 'weight'> {
  if (metrics.totalFixes === 0) {
    return { value: 0, score: 50, status: 'degraded' }; // no data → degraded
  }
  const rate = (metrics.successfulFixes / metrics.totalFixes) * 100;
  const { healthy, degraded } = THRESHOLDS.fixRate;

  let score: number;
  let status: HealthStatus;
  if (rate >= healthy) {
    score = 100;
    status = 'healthy';
  } else if (rate >= degraded) {
    score = 50 + ((rate - degraded) / (healthy - degraded)) * 50;
    status = 'degraded';
  } else {
    score = (rate / degraded) * 50;
    status = 'unhealthy';
  }

  return { value: rate, score: clamp(score, 0, 100), status };
}

/**
 * Score error rate: 100 at or below healthy threshold, linear down to 0.
 * Lower error = higher score.
 */
function scoreErrorRate(metrics: ErrorRateMetrics): Omit<MetricScore, 'weight'> {
  if (metrics.totalOperations === 0) {
    return { value: 0, score: 100, status: 'healthy' };
  }
  const rate = (metrics.failedOperations / metrics.totalOperations) * 100;
  const { healthy, degraded } = THRESHOLDS.errorRate;

  let score: number;
  let status: HealthStatus;
  if (rate <= healthy) {
    score = 100;
    status = 'healthy';
  } else if (rate <= degraded) {
    score = 100 - ((rate - healthy) / (degraded - healthy)) * 50;
    status = 'degraded';
  } else {
    score = Math.max(0, 50 - ((rate - degraded) / degraded) * 50);
    status = 'unhealthy';
  }

  return { value: rate, score: clamp(score, 0, 100), status };
}

/**
 * Score queue depth: lower utilisation = higher score.
 */
function scoreQueueDepth(metrics: QueueDepthMetrics): Omit<MetricScore, 'weight'> {
  const utilisation =
    metrics.capacity > 0 ? metrics.currentDepth / metrics.capacity : 0;
  const { healthy, degraded } = THRESHOLDS.queueUtilization;

  let score: number;
  let status: HealthStatus;
  if (utilisation <= healthy) {
    score = 100;
    status = 'healthy';
  } else if (utilisation <= degraded) {
    score = 100 - ((utilisation - healthy) / (degraded - healthy)) * 50;
    status = 'degraded';
  } else {
    score = Math.max(0, 50 - ((utilisation - degraded) / (1 - degraded)) * 50);
    status = 'unhealthy';
  }

  return { value: utilisation, score: clamp(score, 0, 100), status };
}

/**
 * Score latency: compare p50/p95/p99 against targets using a weighted average
 * of how much each percentile exceeds its target.
 */
function scoreLatency(metrics: LatencyMetrics): Omit<MetricScore, 'weight'> {
  const ratios = [
    metrics.p50Ms / Math.max(metrics.targetP50Ms, 1),
    metrics.p95Ms / Math.max(metrics.targetP95Ms, 1),
    metrics.p99Ms / Math.max(metrics.targetP99Ms, 1),
  ];
  // Weighted: p50 20%, p95 40%, p99 40%
  const weightedRatio =
    0.2 * ratios[0] + 0.4 * ratios[1] + 0.4 * ratios[2];

  const { healthy, degraded } = THRESHOLDS.latencyMultiplier;

  let score: number;
  let status: HealthStatus;
  if (weightedRatio <= healthy) {
    score = 100;
    status = 'healthy';
  } else if (weightedRatio <= degraded) {
    score = 100 - ((weightedRatio - healthy) / (degraded - healthy)) * 50;
    status = 'degraded';
  } else {
    score = Math.max(0, 50 - ((weightedRatio - degraded) / degraded) * 50);
    status = 'unhealthy';
  }

  return { value: weightedRatio, score: clamp(score, 0, 100), status };
}

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

function computeComposite(
  scores: Omit<MetricScore, 'weight'>[],
  weights: number[],
): { compositeScore: number; overallStatus: HealthStatus } {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return { compositeScore: 0, overallStatus: 'degraded' };

  const compositeScore =
    scores.reduce((sum, s, i) => sum + s.score * weights[i], 0) / totalWeight;

  // Overall status is the worst individual status
  const statusOrder: HealthStatus[] = ['healthy', 'degraded', 'unhealthy'];
  let overallStatus: HealthStatus = 'healthy';
  for (const s of scores) {
    if (statusOrder.indexOf(s.status) > statusOrder.indexOf(overallStatus)) {
      overallStatus = s.status;
    }
  }

  return { compositeScore: Math.round(compositeScore), overallStatus };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a single tenant's health score from the given collector.
 * Returns a full TenantHealthReport with per-metric breakdown and suggestions.
 */
export async function computeTenantHealth(
  tenantId: string,
  collector: MetricCollector,
  weights?: Partial<typeof DEFAULT_WEIGHTS>,
): Promise<TenantHealthReport> {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const [fixRate, errorRate, queueDepth, latency] = await Promise.all([
    collector.getFixRate(tenantId),
    collector.getErrorRate(tenantId),
    collector.getQueueDepth(tenantId),
    collector.getLatency(tenantId),
  ]);

  const fixRateScore = { ...scoreFixRate(fixRate), weight: w.fixRate };
  const errorRateScore = { ...scoreErrorRate(errorRate), weight: w.errorRate };
  const queueDepthScore = { ...scoreQueueDepth(queueDepth), weight: w.queueDepth };
  const latencyScore = { ...scoreLatency(latency), weight: w.latency };

  const { compositeScore, overallStatus } = computeComposite(
    [fixRateScore, errorRateScore, queueDepthScore, latencyScore],
    [w.fixRate, w.errorRate, w.queueDepth, w.latency],
  );

  const suggestions: string[] = [];
  if (fixRateScore.status !== 'healthy') {
    suggestions.push(
      `Fix rate is ${fixRateScore.status} (${fixRateScore.value.toFixed(1)}%). Review failed fix runs for ${tenantId}.`,
    );
  }
  if (errorRateScore.status !== 'healthy') {
    suggestions.push(
      `Error rate is ${errorRateScore.status} (${errorRateScore.value.toFixed(1)}%). Investigate operation failures for ${tenantId}.`,
    );
  }
  if (queueDepthScore.status !== 'healthy') {
    suggestions.push(
      `Queue utilisation is ${queueDepthScore.status} (${(queueDepthScore.value * 100).toFixed(0)}%). Consider scaling workers for ${tenantId}.`,
    );
  }
  if (latencyScore.status !== 'healthy') {
    suggestions.push(
      `Latency multiplier is ${latencyScore.status} (${latencyScore.value.toFixed(2)}x). Review pipeline bottlenecks for ${tenantId}.`,
    );
  }

  return {
    score: {
      tenantId,
      timestamp: new Date().toISOString(),
      compositeScore,
      status: overallStatus,
      metrics: {
        fixRate: fixRateScore,
        errorRate: errorRateScore,
        queueDepth: queueDepthScore,
        latency: latencyScore,
      },
    },
    suggestions,
  };
}

/**
 * Compute health scores for all known tenants.
 */
export async function computeAllTenantHealth(
  collector: MetricCollector,
  weights?: Partial<typeof DEFAULT_WEIGHTS>,
): Promise<TenantHealthReport[]> {
  const tenants = await collector.getKnownTenants();
  const reports = await Promise.all(
    tenants.map((id) => computeTenantHealth(id, collector, weights)),
  );

  log.info(
    { tenantCount: tenants.length },
    'Tenant health check complete',
  );

  return reports;
}

/**
 * Aggregate health statistics across all tenants.
 */
export function aggregateHealth(
  reports: TenantHealthReport[],
): {
  totalTenants: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  averageScore: number;
} {
  if (reports.length === 0) {
    return { totalTenants: 0, healthy: 0, degraded: 0, unhealthy: 0, averageScore: 0 };
  }

  let healthy = 0;
  let degraded = 0;
  let unhealthy = 0;
  let totalScore = 0;

  for (const r of reports) {
    switch (r.score.status) {
      case 'healthy': healthy++; break;
      case 'degraded': degraded++; break;
      case 'unhealthy': unhealthy++; break;
    }
    totalScore += r.score.compositeScore;
  }

  return {
    totalTenants: reports.length,
    healthy,
    degraded,
    unhealthy,
    averageScore: Math.round(totalScore / reports.length),
  };
}
