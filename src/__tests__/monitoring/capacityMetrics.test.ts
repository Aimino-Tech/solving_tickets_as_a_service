import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('monitoring/capacityMetrics', () => {
  let capacityMetrics: typeof import('../../monitoring/capacityMetrics.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    capacityMetrics = await import('../../monitoring/capacityMetrics.js');
  });

  describe('createSnapshot', () => {
    it('creates a zeroed snapshot for a given date', () => {
      const snapshot = capacityMetrics.createSnapshot('2025-07-17');

      expect(snapshot.snapshotDate).toBe('2025-07-17');
      expect(snapshot.fixes.totalRuns).toBe(0);
      expect(snapshot.webhooks.totalReceived).toBe(0);
      expect(snapshot.workers.activeWorkers).toBe(0);
      expect(snapshot.queue.currentDepth).toBe(0);
      expect(snapshot.database.activeConnections).toBe(0);
      expect(snapshot.storage.totalBytes).toBe(0);
      expect(snapshot.api.totalRequests).toBe(0);
      expect(snapshot.costs.totalMillicents).toBe(0);
    });

    it('merges partial overrides with zeros', () => {
      const snapshot = capacityMetrics.createSnapshot('2025-07-17', {
        fixes: { totalRuns: 42, successfulRuns: 40, failedRuns: 2, avgDurationMs: 5000, p95DurationMs: 12000 },
        costs: { totalMillicents: 100000, modelMillicents: 60000, sandboxMillicents: 25000, computeMillicents: 15000, avgCostPerFixMillicents: 2381 },
      });

      expect(snapshot.fixes.totalRuns).toBe(42);
      expect(snapshot.fixes.successfulRuns).toBe(40);
      expect(snapshot.fixes.failedRuns).toBe(2);
      expect(snapshot.costs.totalMillicents).toBe(100000);
      expect(snapshot.webhooks.totalReceived).toBe(0);
      expect(snapshot.storage.totalBytes).toBe(0);
    });
  });

  describe('recordSnapshot and getSnapshots', () => {
    it('records and retrieves a snapshot', async () => {
      const snapshot = capacityMetrics.createSnapshot('2025-07-17', {
        fixes: { totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
      });

      await capacityMetrics.recordSnapshot(snapshot);

      const all = capacityMetrics.getSnapshots();
      expect(all).toHaveLength(1);
      expect(all[0].snapshotDate).toBe('2025-07-17');
      expect(all[0].fixes.totalRuns).toBe(10);
    });

    it('replaces an existing snapshot for the same date', async () => {
      const s1 = capacityMetrics.createSnapshot('2025-07-17', {
        fixes: { totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
      });
      const s2 = capacityMetrics.createSnapshot('2025-07-17', {
        fixes: { totalRuns: 20, successfulRuns: 18, failedRuns: 2, avgDurationMs: 3500, p95DurationMs: 9000 },
      });

      await capacityMetrics.recordSnapshot(s1);
      await capacityMetrics.recordSnapshot(s2);

      const all = capacityMetrics.getSnapshots();
      expect(all).toHaveLength(1);
      expect(all[0].fixes.totalRuns).toBe(20);
    });

    it('returns snapshots sorted newest first', async () => {
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-15'));
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-17'));
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-16'));

      const all = capacityMetrics.getSnapshots();
      expect(all.map((s) => s.snapshotDate)).toEqual(['2025-07-17', '2025-07-16', '2025-07-15']);
    });
  });

  describe('getRecentSnapshots', () => {
    it('returns only snapshots within the given day window', async () => {
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-10'));
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-15'));
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-17'));

      const recent = capacityMetrics.getRecentSnapshots(5);
      for (const s of recent) {
        const daysAgo = Math.floor(
          (Date.now() - new Date(s.snapshotDate).getTime()) / (1000 * 60 * 60 * 24),
        );
        expect(daysAgo).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('getSnapshot', () => {
    it('returns undefined for a date with no snapshot', () => {
      expect(capacityMetrics.getSnapshot('2025-01-01')).toBeUndefined();
    });

    it('returns the snapshot for the given date', async () => {
      await capacityMetrics.recordSnapshot(
        capacityMetrics.createSnapshot('2025-07-17', { fixes: { totalRuns: 5, successfulRuns: 5, failedRuns: 0, avgDurationMs: 2000, p95DurationMs: 5000 } }),
      );

      const result = capacityMetrics.getSnapshot('2025-07-17');
      expect(result).toBeDefined();
      expect(result!.fixes.totalRuns).toBe(5);
    });
  });

  describe('projectCapacity', () => {
    it('returns empty array when fewer than 2 snapshots exist', () => {
      const projections = capacityMetrics.projectCapacity(30);
      expect(projections).toEqual([]);
    });

    it('returns projections when sufficient data exists', async () => {
      await capacityMetrics.recordSnapshot(
        capacityMetrics.createSnapshot('2025-07-01', {
          fixes: { totalRuns: 10, successfulRuns: 9, failedRuns: 1, avgDurationMs: 3000, p95DurationMs: 8000 },
          storage: { totalBytes: 1000000, dbSizeBytes: 800000, logSizeBytes: 200000, rowCount: 5000, growthBytes24h: 10000 },
          costs: { totalMillicents: 50000, modelMillicents: 30000, sandboxMillicents: 12000, computeMillicents: 8000, avgCostPerFixMillicents: 5000 },
        }),
      );
      await capacityMetrics.recordSnapshot(
        capacityMetrics.createSnapshot('2025-07-17', {
          fixes: { totalRuns: 20, successfulRuns: 18, failedRuns: 2, avgDurationMs: 3500, p95DurationMs: 9000 },
          storage: { totalBytes: 2000000, dbSizeBytes: 1600000, logSizeBytes: 400000, rowCount: 10000, growthBytes24h: 20000 },
          costs: { totalMillicents: 100000, modelMillicents: 60000, sandboxMillicents: 24000, computeMillicents: 16000, avgCostPerFixMillicents: 5000 },
        }),
      );

      const projections = capacityMetrics.projectCapacity(7);
      expect(projections).toHaveLength(7);
      expect(projections[0].date).toBe('2025-07-18');
      expect(projections[0].estimatedFixes).toBeGreaterThan(0);
      expect(projections[0].estimatedCostMillicents).toBeGreaterThan(0);
      expect(projections[0].estimatedStorageBytes).toBeGreaterThan(0);
    });
  });

  describe('clearSnapshots', () => {
    it('removes all snapshots from memory', async () => {
      await capacityMetrics.recordSnapshot(capacityMetrics.createSnapshot('2025-07-17'));
      expect(capacityMetrics.getSnapshots()).toHaveLength(1);

      capacityMetrics.clearSnapshots();
      expect(capacityMetrics.getSnapshots()).toHaveLength(0);
    });
  });
});
