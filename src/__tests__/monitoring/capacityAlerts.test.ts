import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DailyCapacitySnapshot } from '../../monitoring/capacityMetrics.js';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(date: string, overrides: Partial<DailyCapacitySnapshot> = {}): DailyCapacitySnapshot {
  return {
    snapshotDate: date,
    fixes: { totalRuns: 0, successfulRuns: 0, failedRuns: 0, avgDurationMs: 0, p95DurationMs: 0, ...overrides.fixes },
    webhooks: { totalReceived: 0, totalDelivered: 0, failedDeliveries: 0, avgLatencyMs: 0, ...overrides.webhooks },
    workers: { activeWorkers: 0, crashedWorkers: 0, avgHeartbeatLatencyMs: 0, maxConcurrentTasks: 0, ...overrides.workers },
    queue: { currentDepth: 0, maxDepth: 0, throughputPerMinute: 0, avgWaitTimeMs: 0, ...overrides.queue },
    database: { activeConnections: 0, totalQueries: 0, avgQueryTimeMs: 0, slowQueries: 0, ...overrides.database },
    storage: { totalBytes: 0, dbSizeBytes: 0, logSizeBytes: 0, rowCount: 0, growthBytes24h: 0, ...overrides.storage },
    api: { totalRequests: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, errorRatePercent: 0, ...overrides.api },
    costs: { totalMillicents: 0, modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0, avgCostPerFixMillicents: 0, ...overrides.costs },
  };
}

function makeGrowingSnapshots(days: number, startDate: string, startBytes: number, dailyGrowth: number): DailyCapacitySnapshot[] {
  const snapshots: DailyCapacitySnapshot[] = [];
  const start = new Date(startDate);
  let bytes = startBytes;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    snapshots.push(
      makeSnapshot(d.toISOString().slice(0, 10), {
        storage: { totalBytes: bytes, dbSizeBytes: Math.round(bytes * 0.8), logSizeBytes: Math.round(bytes * 0.2), rowCount: 0, growthBytes24h: dailyGrowth },
      }),
    );
    bytes += dailyGrowth;
  }
  return snapshots.reverse();
}

describe('monitoring/capacityAlerts', () => {
  let alertModule: typeof import('../../monitoring/capacityAlerts.js');
  const captured: import('../../monitoring/capacityAlerts.js').CapacityAlertEvent[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    captured.length = 0;
    alertModule = await import('../../monitoring/capacityAlerts.js');
    alertModule.onAlert((e) => captured.push(e));
  });

  afterEach(() => {
    alertModule.clearHandlers();
  });

  describe('checkDiskUsage', () => {
    it('does not fire alerts when storage growth is slow (doubling >90d)', () => {
      const snapshots = makeGrowingSnapshots(7, '2025-07-10', 1_000_000, 1_000);
      alertModule.checkDiskUsage(snapshots);
      expect(captured).toHaveLength(0);
    });

    it('fires warning when storage doubling time is <= 90 days', () => {
      const snapshots = makeGrowingSnapshots(7, '2025-07-10', 80_000_000, 2_000_000);
      alertModule.checkDiskUsage(snapshots);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      const alert = captured.find((a) => a.rule === 'disk_80');
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('warning');
    });

    it('fires critical when storage doubling time is <= 45 days', () => {
      const snapshots = makeGrowingSnapshots(7, '2025-07-10', 10_000_000, 500_000);
      alertModule.checkDiskUsage(snapshots);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      const alert = captured.find((a) => a.rule === 'disk_90');
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('critical');
    });

    it('does not fire when fewer than 2 snapshots exist', () => {
      alertModule.checkDiskUsage([makeSnapshot('2025-07-17')]);
      expect(captured).toHaveLength(0);
    });
  });

  describe('checkCostSpike', () => {
    it('does not fire alert when costs are stable', () => {
      const snapshots: DailyCapacitySnapshot[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date('2025-07-01');
        d.setDate(d.getDate() + i);
        snapshots.push(
          makeSnapshot(d.toISOString().slice(0, 10), {
            costs: { totalMillicents: 50000, modelMillicents: 30000, sandboxMillicents: 12000, computeMillicents: 8000, avgCostPerFixMillicents: 5000 },
          }),
        );
      }
      snapshots.reverse();
      alertModule.checkCostSpike(snapshots);
      expect(captured).toHaveLength(0);
    });

    it('fires warning when daily cost exceeds 2x rolling average', () => {
      const snapshots: DailyCapacitySnapshot[] = [];
      for (let i = 0; i < 8; i++) {
        const d = new Date('2025-07-01');
        d.setDate(d.getDate() + i);
        snapshots.push(
          makeSnapshot(d.toISOString().slice(0, 10), {
            costs: { totalMillicents: 50000, modelMillicents: 30000, sandboxMillicents: 12000, computeMillicents: 8000, avgCostPerFixMillicents: 5000 },
          }),
        );
      }
      snapshots.push(
        makeSnapshot('2025-07-17', {
          costs: { totalMillicents: 150000, modelMillicents: 90000, sandboxMillicents: 36000, computeMillicents: 24000, avgCostPerFixMillicents: 15000 },
        }),
      );
      snapshots.reverse();

      alertModule.checkCostSpike(snapshots);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      const alert = captured.find((a) => a.rule === 'cost_spike');
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('warning');
    });

    it('does not fire when fewer than 8 snapshots exist', () => {
      const snapshots = [makeSnapshot('2025-07-17', { costs: { totalMillicents: 999999, modelMillicents: 0, sandboxMillicents: 0, computeMillicents: 0, avgCostPerFixMillicents: 0 } })];
      alertModule.checkCostSpike(snapshots);
      expect(captured).toHaveLength(0);
    });
  });

  describe('checkGrowthAcceleration', () => {
    it('fires warning when WoW fix growth exceeds 20%', () => {
      const snapshots: DailyCapacitySnapshot[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date('2025-07-10');
        d.setDate(d.getDate() + i);
        snapshots.push(
          makeSnapshot(d.toISOString().slice(0, 10), {
            fixes: { totalRuns: 5, successfulRuns: 4, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
          }),
        );
      }
      for (let i = 0; i < 7; i++) {
        const d = new Date('2025-07-17');
        d.setDate(d.getDate() + i);
        snapshots.push(
          makeSnapshot(d.toISOString().slice(0, 10), {
            fixes: { totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
          }),
        );
      }
      snapshots.reverse();

      alertModule.checkGrowthAcceleration(snapshots);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      const alert = captured.find((a) => a.rule === 'growth_acceleration');
      expect(alert).toBeDefined();
      expect(alert!.severity).toBe('warning');
    });

    it('does not fire when WoW growth is under threshold', () => {
      const snapshots: DailyCapacitySnapshot[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date('2025-07-01');
        d.setDate(d.getDate() + i);
        snapshots.push(
          makeSnapshot(d.toISOString().slice(0, 10), {
            fixes: { totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
          }),
        );
      }
      snapshots.reverse();

      alertModule.checkGrowthAcceleration(snapshots);
      expect(captured).toHaveLength(0);
    });

    it('does not fire when fewer than 14 snapshots exist', () => {
      const snapshots = [makeSnapshot('2025-07-17')];
      alertModule.checkGrowthAcceleration(snapshots);
      expect(captured).toHaveLength(0);
    });
  });

  describe('runAllChecks', () => {
    it('returns fired alerts without disturbing registered handlers', () => {
      const permanent: Array<import('../../monitoring/capacityAlerts.js').CapacityAlertEvent> = [];
      alertModule.onAlert((e) => permanent.push(e));

      const snapshots: DailyCapacitySnapshot[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date('2025-07-10');
        d.setDate(d.getDate() + i);
        snapshots.push(
          makeSnapshot(d.toISOString().slice(0, 10), {
            fixes: { totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
            costs: { totalMillicents: 50000, modelMillicents: 30000, sandboxMillicents: 12000, computeMillicents: 8000, avgCostPerFixMillicents: 5000 },
            storage: { totalBytes: 80_000_000, dbSizeBytes: 64_000_000, logSizeBytes: 16_000_000, rowCount: 100000, growthBytes24h: 3_000_000 },
          }),
        );
      }
      snapshots.push(
        makeSnapshot('2025-07-24', {
          fixes: { totalRuns: 20, successfulRuns: 18, failedRuns: 2, avgDurationMs: 3000, p95DurationMs: 8000 },
          costs: { totalMillicents: 150000, modelMillicents: 90000, sandboxMillicents: 36000, computeMillicents: 24000, avgCostPerFixMillicents: 7500 },
          storage: { totalBytes: 90_000_000, dbSizeBytes: 72_000_000, logSizeBytes: 18_000_000, rowCount: 110000, growthBytes24h: 10_000_000 },
        }),
      );
      snapshots.reverse();

      const fired = alertModule.runAllChecks(snapshots);
      expect(fired.length).toBeGreaterThan(0);
      // Permanent handler should NOT fire during runAllChecks (suppressed to avoid duplicates)
      expect(permanent.length).toBe(0);
    });
  });
});
