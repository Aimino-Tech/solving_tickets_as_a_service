import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MetricCollector, FixRateMetrics, ErrorRateMetrics, QueueDepthMetrics, LatencyMetrics } from '../../monitoring/tenantHealth.js';

vi.mock('../../config.js', () => ({
  config: {},
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCollector(overrides?: {
  fixRate?: FixRateMetrics;
  errorRate?: ErrorRateMetrics;
  queueDepth?: QueueDepthMetrics;
  latency?: LatencyMetrics;
  tenants?: string[];
}): MetricCollector {
  return {
    getFixRate: vi.fn().mockResolvedValue(
      overrides?.fixRate ?? { totalFixes: 100, successfulFixes: 95 },
    ),
    getErrorRate: vi.fn().mockResolvedValue(
      overrides?.errorRate ?? { totalOperations: 200, failedOperations: 5 },
    ),
    getQueueDepth: vi.fn().mockResolvedValue(
      overrides?.queueDepth ?? { currentDepth: 10, capacity: 100 },
    ),
    getLatency: vi.fn().mockResolvedValue(
      overrides?.latency ?? { p50Ms: 100, p95Ms: 500, p99Ms: 1500, targetP50Ms: 200, targetP95Ms: 1000, targetP99Ms: 3000 },
    ),
    getKnownTenants: vi.fn().mockResolvedValue(overrides?.tenants ?? ['tenant-alpha']),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('monitoring/tenantHealth', () => {
  let tenantHealth: typeof import('../../monitoring/tenantHealth.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    tenantHealth = await import('../../monitoring/tenantHealth.js');
  });

  // ── computeTenantHealth ────────────────────────────────────────────

  describe('computeTenantHealth', () => {
    it('returns healthy for well-performing tenant', async () => {
      const collector = createMockCollector();
      const report = await tenantHealth.computeTenantHealth('tenant-alpha', collector);

      expect(report.score.tenantId).toBe('tenant-alpha');
      expect(report.score.compositeScore).toBeGreaterThanOrEqual(80);
      expect(report.score.status).toBe('healthy');
      expect(report.suggestions).toHaveLength(0);
    });

    it('flags fix rate as degraded for moderate failure rate', async () => {
      const collector = createMockCollector({
        fixRate: { totalFixes: 100, successfulFixes: 80 },
      });
      const report = await tenantHealth.computeTenantHealth('tenant-beta', collector);

      expect(report.score.metrics.fixRate.status).toBe('degraded');
      expect(report.score.metrics.fixRate.score).toBeLessThan(100);
      expect(report.suggestions.some((s) => s.includes('Fix rate'))).toBe(true);
    });

    it('flags error rate as unhealthy for high failure rate', async () => {
      const collector = createMockCollector({
        errorRate: { totalOperations: 100, failedOperations: 40 },
      });
      const report = await tenantHealth.computeTenantHealth('tenant-gamma', collector);

      expect(report.score.metrics.errorRate.status).toBe('unhealthy');
      expect(report.score.metrics.errorRate.score).toBeLessThan(50);
      expect(report.suggestions.some((s) => s.includes('Error rate'))).toBe(true);
    });

    it('handles empty fix data (no runs yet)', async () => {
      const collector = createMockCollector({
        fixRate: { totalFixes: 0, successfulFixes: 0 },
      });
      const report = await tenantHealth.computeTenantHealth('tenant-new', collector);

      // No data → degraded with score 50
      expect(report.score.metrics.fixRate.status).toBe('degraded');
      expect(report.score.metrics.fixRate.score).toBe(50);
    });

    it('handles empty error data (no operations yet)', async () => {
      const collector = createMockCollector({
        errorRate: { totalOperations: 0, failedOperations: 0 },
      });
      const report = await tenantHealth.computeTenantHealth('tenant-clean', collector);

      // No errors → healthy
      expect(report.score.metrics.errorRate.status).toBe('healthy');
      expect(report.score.metrics.errorRate.score).toBe(100);
    });

    it('detects queue depth issues', async () => {
      const collector = createMockCollector({
        queueDepth: { currentDepth: 90, capacity: 100 },
      });
      const report = await tenantHealth.computeTenantHealth('tenant-queued', collector);

      expect(report.score.metrics.queueDepth.status).toBe('unhealthy');
      expect(report.suggestions.some((s) => s.includes('Queue'))).toBe(true);
    });

    it('detects latency issues', async () => {
      const collector = createMockCollector({
        latency: { p50Ms: 500, p95Ms: 3000, p99Ms: 10000, targetP50Ms: 200, targetP95Ms: 1000, targetP99Ms: 3000 },
      });
      const report = await tenantHealth.computeTenantHealth('tenant-slow', collector);

      expect(report.score.metrics.latency.status).toBe('unhealthy');
      expect(report.suggestions.some((s) => s.includes('Latency'))).toBe(true);
    });

    it('uses custom weights when provided', async () => {
      const collector = createMockCollector();
      const report = await tenantHealth.computeTenantHealth('tenant-alpha', collector, {
        fixRate: 0.5,
        errorRate: 0.5,
        queueDepth: 0,
        latency: 0,
      });

      expect(report.score.tenantId).toBe('tenant-alpha');
      // With custom weights the score should still be computed (just weighted differently)
      expect(report.score.compositeScore).toBeGreaterThanOrEqual(0);
    });

    it('collects metrics in parallel via Promise.all', async () => {
      const getFixRate = vi.fn().mockResolvedValue({ totalFixes: 100, successfulFixes: 95 });
      const getErrorRate = vi.fn().mockResolvedValue({ totalOperations: 200, failedOperations: 5 });
      const getQueueDepth = vi.fn().mockResolvedValue({ currentDepth: 10, capacity: 100 });
      const getLatency = vi.fn().mockResolvedValue({
        p50Ms: 100, p95Ms: 500, p99Ms: 1500, targetP50Ms: 200, targetP95Ms: 1000, targetP99Ms: 3000,
      });

      const collector: MetricCollector = {
        getFixRate,
        getErrorRate,
        getQueueDepth,
        getLatency,
        getKnownTenants: vi.fn().mockResolvedValue(['t1']),
      };

      await tenantHealth.computeTenantHealth('t1', collector);

      expect(getFixRate).toHaveBeenCalledWith('t1');
      expect(getErrorRate).toHaveBeenCalledWith('t1');
      expect(getQueueDepth).toHaveBeenCalledWith('t1');
      expect(getLatency).toHaveBeenCalledWith('t1');
    });
  });

  // ── computeAllTenantHealth ─────────────────────────────────────────

  describe('computeAllTenantHealth', () => {
    it('returns reports for all known tenants', async () => {
      const collector = createMockCollector({ tenants: ['t1', 't2', 't3'] });
      const reports = await tenantHealth.computeAllTenantHealth(collector);

      expect(reports).toHaveLength(3);
      expect(reports.map((r) => r.score.tenantId).sort()).toEqual(['t1', 't2', 't3']);
    });

    it('returns empty array when no tenants exist', async () => {
      const collector = createMockCollector({ tenants: [] });
      const reports = await tenantHealth.computeAllTenantHealth(collector);

      expect(reports).toHaveLength(0);
    });
  });

  // ── aggregateHealth ────────────────────────────────────────────────

  describe('aggregateHealth', () => {
    it('aggregates multiple tenant reports correctly', async () => {
      // We need to create reports manually since we need specific status values
      const reports = [
        {
          score: {
            tenantId: 't1', timestamp: '', compositeScore: 95, status: 'healthy' as const,
            metrics: {} as any,
          },
          suggestions: [],
        },
        {
          score: {
            tenantId: 't2', timestamp: '', compositeScore: 65, status: 'degraded' as const,
            metrics: {} as any,
          },
          suggestions: [],
        },
        {
          score: {
            tenantId: 't3', timestamp: '', compositeScore: 30, status: 'unhealthy' as const,
            metrics: {} as any,
          },
          suggestions: [],
        },
      ];

      const agg = tenantHealth.aggregateHealth(reports as any);

      expect(agg.totalTenants).toBe(3);
      expect(agg.healthy).toBe(1);
      expect(agg.degraded).toBe(1);
      expect(agg.unhealthy).toBe(1);
      expect(agg.averageScore).toBe(63); // (95 + 65 + 30) / 3 ≈ 63
    });

    it('returns zeros for empty report array', async () => {
      const agg = tenantHealth.aggregateHealth([]);

      expect(agg.totalTenants).toBe(0);
      expect(agg.healthy).toBe(0);
      expect(agg.degraded).toBe(0);
      expect(agg.unhealthy).toBe(0);
      expect(agg.averageScore).toBe(0);
    });
  });

  // ── THRESHOLDS and DEFAULT_WEIGHTS exports ─────────────────────────

  describe('constants', () => {
    it('exports DEFAULT_WEIGHTS summing to 1', () => {
      const sum = Object.values(tenantHealth.DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1);
    });

    it('exports THRESHOLDS with expected structure', () => {
      expect(tenantHealth.THRESHOLDS.fixRate.healthy).toBe(90);
      expect(tenantHealth.THRESHOLDS.errorRate.healthy).toBe(5);
      expect(tenantHealth.THRESHOLDS.queueUtilization.healthy).toBe(0.6);
      expect(tenantHealth.THRESHOLDS.latencyMultiplier.healthy).toBe(1.0);
    });
  });
});
