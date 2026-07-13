/**
 * Tests for TrustStore — SQLite-backed per-repo trust metrics.
 *
 * Uses an in-memory SQLite database so tests are fast and isolated.
 * The global mock of better-sqlite3 in setup.ts is un-mocked so the
 * real SQLite implementation is used.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { TrustStore, type FixResult } from '../core/trust-store.js';

// Un-mock better-sqlite3 so we use the real SQLite with :memory:
vi.unmock('better-sqlite3');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFix(overrides: Partial<FixResult> = {}): FixResult {
  return {
    success: true,
    testPassCount: 42,
    testFailCount: 0,
    gatesPassed: 6,
    gatesFailed: 0,
    fixTimeMs: 15_000,
    failureReasons: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrustStore', () => {
  let store: TrustStore;

  beforeEach(() => {
    store = new TrustStore(':memory:');
  });

  // ── getMetrics ─────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns null for an unknown repo', async () => {
      await expect(store.getMetrics('unknown/repo')).resolves.toBeNull();
    });

    it('returns metrics after a fix is recorded', async () => {
      await store.updateAfterFix('owner/repo', makeFix());

      const metrics = await store.getMetrics('owner/repo');
      expect(metrics).not.toBeNull();
      expect(metrics!.repoName).toBe('owner/repo');
      expect(metrics!.totalFixes).toBe(1);
      expect(metrics!.acceptedFixes).toBe(1);
      expect(metrics!.rejectedFixes).toBe(0);
      expect(metrics!.totalTestPassCount).toBe(42);
      expect(metrics!.totalGatesPassed).toBe(6);
      expect(metrics!.averageFixTimeMs).toBe(15_000);
    });

    it('returns null when store is empty', async () => {
      await expect(store.getMetrics('any/repo')).resolves.toBeNull();
    });
  });

  // ── updateAfterFix ─────────────────────────────────────────────────────

  describe('updateAfterFix', () => {
    it('creates a new record on first fix', async () => {
      await store.updateAfterFix('owner/repo', makeFix());
      await expect(store.getMetrics('owner/repo')).resolves.not.toBeNull();
    });

    it('increments counters on subsequent fixes', async () => {
      await store.updateAfterFix('owner/repo', makeFix());
      await store.updateAfterFix('owner/repo', makeFix({ testPassCount: 10 }));

      const m = await store.getMetrics('owner/repo');
      expect(m!.totalFixes).toBe(2);
      expect(m!.acceptedFixes).toBe(2);
      // Total test passes: 42 + 10 = 52
      expect(m!.totalTestPassCount).toBe(52);
    });

    it('tracks rejected fixes', async () => {
      await store.updateAfterFix(
        'owner/repo',
        makeFix({ success: false, failureReasons: ['Test timeout'] }),
      );

      const m = await store.getMetrics('owner/repo');
      expect(m!.acceptedFixes).toBe(0);
      expect(m!.rejectedFixes).toBe(1);
      expect(m!.totalFixes).toBe(1);
    });

    it('records failure reasons', async () => {
      await store.updateAfterFix(
        'owner/repo',
        makeFix({
          success: false,
          failureReasons: ['Lint error', 'Test timeout'],
        }),
      );

      const m = await store.getMetrics('owner/repo');
      expect(m!.topFailureReasons).toHaveLength(2);
      const reasons = m!.topFailureReasons.map((r) => r.reason).sort();
      expect(reasons).toEqual(['Lint error', 'Test timeout']);
    });

    it('increments failure reason counts', async () => {
      for (let i = 0; i < 3; i++) {
        await store.updateAfterFix(
          'owner/repo',
          makeFix({ success: false, failureReasons: ['Test timeout'] }),
        );
      }

      const m = await store.getMetrics('owner/repo');
      const timeout = m!.topFailureReasons.find(
        (r) => r.reason === 'Test timeout',
      );
      expect(timeout?.count).toBe(3);
    });
  });

  // ── getLeaderboard ─────────────────────────────────────────────────────

  describe('getLeaderboard', () => {
    it('returns empty array when no data', async () => {
      const board = await store.getLeaderboard();
      expect(board).toEqual([]);
    });

    it('orders repos by accepted fixes descending', async () => {
      await store.updateAfterFix('repo-a', makeFix());
      await store.updateAfterFix('repo-a', makeFix());
      await store.updateAfterFix('repo-b', makeFix());

      const board = await store.getLeaderboard(10);
      expect(board).toHaveLength(2);
      expect(board[0].repoName).toBe('repo-a');
      expect(board[0].acceptedFixes).toBe(2);
      expect(board[1].repoName).toBe('repo-b');
      expect(board[1].acceptedFixes).toBe(1);
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await store.updateAfterFix(`repo-${i}`, makeFix());
      }

      const board = await store.getLeaderboard(3);
      expect(board).toHaveLength(3);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles special characters in repo names', async () => {
      await store.updateAfterFix('owner/My.Repo_Name-v2', makeFix());
      const m = await store.getMetrics('owner/My.Repo_Name-v2');
      expect(m).not.toBeNull();
      expect(m!.repoName).toBe('owner/My.Repo_Name-v2');
    });

    it('computes average fix time correctly', async () => {
      await store.updateAfterFix('owner/repo', makeFix({ fixTimeMs: 10_000 }));
      await store.updateAfterFix('owner/repo', makeFix({ fixTimeMs: 20_000 }));

      const m = await store.getMetrics('owner/repo');
      // (10000 + 20000) / 2 = 15000
      expect(m!.averageFixTimeMs).toBe(15_000);
    });
  });
});
