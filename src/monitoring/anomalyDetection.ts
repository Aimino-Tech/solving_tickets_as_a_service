/**
 * Real-time statistical anomaly detection for STAS (AIM-3228).
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'anomaly-detection' });

export interface AnomalyResult {
  anomaly: boolean;
  score: number;
  message: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function checkQueueDepthAnomaly(
  currentDepth: number,
  rollingMean1h: number,
  stdDev1h: number,
): AnomalyResult {
  if (stdDev1h <= 0) {
    return { anomaly: false, score: 0, message: 'Queue depth STDDEV is zero - insufficient data' };
  }

  const zScore = Math.abs((currentDepth - rollingMean1h) / stdDev1h);
  const anomaly = zScore > 3;
  const score = clamp(zScore / 3, 0, 2);

  return {
    anomaly,
    score,
    message: anomaly
      ? `Anomalous queue depth: ${currentDepth} (mean ${rollingMean1h.toFixed(1)}, sigma ${stdDev1h.toFixed(1)}, z=${zScore.toFixed(2)} > 3)`
      : `Queue depth normal: ${currentDepth} (z=${zScore.toFixed(2)})`,
  };
}

export function checkErrorRateSpike(
  currentRate: number,
  baselineRate: number,
  baselineStd: number,
): AnomalyResult {
  if (baselineStd <= 0) {
    return { anomaly: false, score: 0, message: 'Error rate STDDEV is zero - insufficient data' };
  }

  const zScore = Math.abs((currentRate - baselineRate) / baselineStd);
  const anomaly = zScore > 2;
  const score = clamp(zScore / 2, 0, 2);

  return {
    anomaly,
    score,
    message: anomaly
      ? `Error rate spike: ${currentRate.toFixed(2)}% (baseline ${baselineRate.toFixed(2)}% +/- ${baselineStd.toFixed(2)}, z=${zScore.toFixed(2)} > 2)`
      : `Error rate normal: ${currentRate.toFixed(2)}% (z=${zScore.toFixed(2)})`,
  };
}

export function checkLatencyDegradation(
  currentP95: number,
  baselineP95: number,
): AnomalyResult {
  if (baselineP95 <= 0) {
    return { anomaly: false, score: 0, message: 'Baseline P95 is zero - insufficient data' };
  }

  const increaseRatio = (currentP95 - baselineP95) / baselineP95;
  const anomaly = increaseRatio > 0.2;
  const score = clamp(increaseRatio / 0.2, 0, 2);

  return {
    anomaly,
    score,
    message: anomaly
      ? `Latency degraded: P95=${currentP95}ms (baseline ${baselineP95}ms, +${(increaseRatio * 100).toFixed(1)}% > 20%)`
      : `Latency normal: P95=${currentP95}ms (baseline ${baselineP95}ms, ${(increaseRatio * 100).toFixed(1)}%)`,
  };
}

export function checkThroughputDrop(
  throughput5m: number,
  throughput1hAvg: number,
): AnomalyResult {
  if (throughput1hAvg <= 0) {
    return { anomaly: false, score: 0, message: '1h throughput average is zero - insufficient data' };
  }

  const ratio = throughput5m / throughput1hAvg;
  const anomaly = ratio < 0.5;
  const score = clamp(1 - ratio, 0, 1);

  return {
    anomaly,
    score,
    message: anomaly
      ? `Throughput drop: ${throughput5m} jobs/5min (1h avg ${throughput1hAvg.toFixed(1)}, ratio ${(ratio * 100).toFixed(1)}% < 50%)`
      : `Throughput normal: ${throughput5m} jobs/5min (1h avg ${throughput1hAvg.toFixed(1)}, ratio ${(ratio * 100).toFixed(1)}%)`,
  };
}

export function checkWorkerHealth(restarts5m: number): AnomalyResult {
  const threshold = 3;
  const anomaly = restarts5m > threshold;
  const score = threshold > 0 ? clamp(restarts5m / threshold, 0, 2) : 0;

  return {
    anomaly,
    score,
    message: anomaly
      ? `Worker health anomaly: ${restarts5m} restarts in 5 min (threshold ${threshold})`
      : `Worker health OK: ${restarts5m} restarts in 5 min`,
  };
}

export function checkDbPoolUsage(poolUsageRatio: number): AnomalyResult {
  const threshold = 0.8;
  const anomaly = poolUsageRatio > threshold;
  const excess = poolUsageRatio - threshold;
  const score = threshold > 0 ? clamp(excess / threshold, 0, 2) : 0;

  return {
    anomaly,
    score,
    message: anomaly
      ? `DB pool exhaustion: ${(poolUsageRatio * 100).toFixed(1)}% used (threshold ${(threshold * 100)}%)`
      : `DB pool healthy: ${(poolUsageRatio * 100).toFixed(1)}% used`,
  };
}
