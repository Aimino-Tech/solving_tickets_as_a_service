import { describe, expect, it } from 'vitest';

import {
  checkQueueDepthAnomaly,
  checkErrorRateSpike,
  checkLatencyDegradation,
  checkThroughputDrop,
  checkWorkerHealth,
  checkDbPoolUsage,
} from '../../monitoring/anomalyDetection.js';

describe('checkQueueDepthAnomaly', () => {
  it('returns anomaly=false when z-score <= 3', () => {
    const result = checkQueueDepthAnomaly(110, 100, 10);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('returns anomaly=true when z-score > 3', () => {
    const result = checkQueueDepthAnomaly(150, 100, 10);
    expect(result.anomaly).toBe(true);
    expect(result.score).toBeGreaterThan(1);
    expect(result.message).toContain('Anomalous queue depth');
  });

  it('handles zero stddev gracefully', () => {
    const result = checkQueueDepthAnomaly(50, 50, 0);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
    expect(result.message).toContain('insufficient data');
  });

  it('clamps score at 2 for extreme z-scores', () => {
    const result = checkQueueDepthAnomaly(1000, 100, 10);
    expect(result.score).toBe(2);
  });

  it('detects anomaly when depth is far below mean (z > 3)', () => {
    const result = checkQueueDepthAnomaly(50, 100, 10);
    expect(result.anomaly).toBe(true);
    expect(result.message).toContain('Anomalous queue depth');
  });
});

describe('checkErrorRateSpike', () => {
  it('returns anomaly=false when z-score <= 2', () => {
    const result = checkErrorRateSpike(3, 2, 1);
    expect(result.anomaly).toBe(false);
  });

  it('returns anomaly=true when z-score > 2', () => {
    const result = checkErrorRateSpike(10, 2, 1);
    expect(result.anomaly).toBe(true);
    expect(result.message).toContain('Error rate spike');
  });

  it('handles zero stddev gracefully', () => {
    const result = checkErrorRateSpike(5, 5, 0);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
  });

  it('handles current rate below baseline', () => {
    const result = checkErrorRateSpike(0.5, 2, 1);
    expect(result.anomaly).toBe(false);
  });

  it('clamps score at 2', () => {
    const result = checkErrorRateSpike(50, 2, 1);
    expect(result.score).toBe(2);
  });
});

describe('checkLatencyDegradation', () => {
  it('returns anomaly=false when increase <= 20%', () => {
    const result = checkLatencyDegradation(110, 100);
    expect(result.anomaly).toBe(false);
  });

  it('returns anomaly=true when increase > 20%', () => {
    const result = checkLatencyDegradation(150, 100);
    expect(result.anomaly).toBe(true);
    expect(result.message).toContain('Latency degraded');
  });

  it('handles zero baseline', () => {
    const result = checkLatencyDegradation(200, 0);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
    expect(result.message).toContain('insufficient data');
  });

  it('handles decreased latency (improvement)', () => {
    const result = checkLatencyDegradation(80, 100);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
  });

  it('score reflects severity', () => {
    const result = checkLatencyDegradation(300, 100);
    expect(result.anomaly).toBe(true);
    expect(result.score).toBeGreaterThan(1);
  });
});

describe('checkThroughputDrop', () => {
  it('returns anomaly=false when ratio >= 0.5', () => {
    const result = checkThroughputDrop(60, 100);
    expect(result.anomaly).toBe(false);
  });

  it('returns anomaly=true when ratio < 0.5', () => {
    const result = checkThroughputDrop(30, 100);
    expect(result.anomaly).toBe(true);
    expect(result.message).toContain('Throughput drop');
  });

  it('handles zero 1h average', () => {
    const result = checkThroughputDrop(10, 0);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
  });

  it('handles zero throughput (complete stall)', () => {
    const result = checkThroughputDrop(0, 100);
    expect(result.anomaly).toBe(true);
    expect(result.score).toBe(1);
  });

  it('handles throughput above average', () => {
    const result = checkThroughputDrop(200, 100);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
  });
});

describe('checkWorkerHealth', () => {
  it('returns anomaly=false when restarts <= 3', () => {
    const result = checkWorkerHealth(2);
    expect(result.anomaly).toBe(false);
  });

  it('returns anomaly=true when restarts > 3', () => {
    const result = checkWorkerHealth(5);
    expect(result.anomaly).toBe(true);
    expect(result.message).toContain('Worker health anomaly');
  });

  it('handles zero restarts', () => {
    const result = checkWorkerHealth(0);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
  });

  it('clamps score at 2 for many restarts', () => {
    const result = checkWorkerHealth(99);
    expect(result.anomaly).toBe(true);
    expect(result.score).toBe(2);
  });
});

describe('checkDbPoolUsage', () => {
  it('returns anomaly=false when usage <= 80%', () => {
    const result = checkDbPoolUsage(0.7);
    expect(result.anomaly).toBe(false);
  });

  it('returns anomaly=true when usage > 80%', () => {
    const result = checkDbPoolUsage(0.9);
    expect(result.anomaly).toBe(true);
    expect(result.message).toContain('DB pool exhaustion');
  });

  it('handles 100% pool usage', () => {
    const result = checkDbPoolUsage(1.0);
    expect(result.anomaly).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('handles low pool usage', () => {
    const result = checkDbPoolUsage(0.1);
    expect(result.anomaly).toBe(false);
    expect(result.score).toBe(0);
  });
});
