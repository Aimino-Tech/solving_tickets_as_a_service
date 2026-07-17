/**
 * TrustStore — SQLite-backed per-repo trust metrics.
 *
 * Tracks fix history, test results, quality gate outcomes, and failure
 * patterns so the trust dashboard can show how reliable each repo's fixes
 * are.
 */
import Database from 'better-sqlite3';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixResult {
  /** Whether the fix was accepted (merged / approved). */
  success: boolean;
  /** Number of tests that passed during verification. */
  testPassCount: number;
  /** Number of tests that failed during verification. */
  testFailCount: number;
  /** Number of quality gates passed. */
  gatesPassed: number;
  /** Number of quality gates failed. */
  gatesFailed: number;
  /** How long the fix took in milliseconds. */
  fixTimeMs: number;
  /** Human-readable failure reasons (e.g. "Test timeout", "Lint error"). */
  failureReasons?: string[];
}

export interface RepoTrustMetrics {
  repoId: string;
  repoName: string;
  totalFixes: number;
  acceptedFixes: number;
  rejectedFixes: number;
  regressions7d: number;
  totalTestPassCount: number;
  totalTestFailCount: number;
  totalGatesPassed: number;
  totalGatesFailed: number;
  averageFixTimeMs: number;
  topFailureReasons: { reason: string; count: number }[];
  lastUpdated: Date;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repo_trust (
  repo_id          TEXT PRIMARY KEY,
  repo_name        TEXT NOT NULL,
  total_fixes      INTEGER DEFAULT 0,
  accepted_fixes   INTEGER DEFAULT 0,
  rejected_fixes   INTEGER DEFAULT 0,
  regressions_7d   INTEGER DEFAULT 0,
  total_test_pass  INTEGER DEFAULT 0,
  total_test_fail  INTEGER DEFAULT 0,
  total_gates_passed  INTEGER DEFAULT 0,
  total_gates_failed  INTEGER DEFAULT 0,
  avg_fix_time_ms  INTEGER DEFAULT 0,
  last_updated     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS failure_reasons (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id  TEXT NOT NULL,
  reason   TEXT NOT NULL,
  count    INTEGER DEFAULT 1,
  UNIQUE(repo_id, reason),
  FOREIGN KEY (repo_id) REFERENCES repo_trust(repo_id)
);
`;

// ---------------------------------------------------------------------------
// TrustStore
// ---------------------------------------------------------------------------

export class TrustStore {
  private db: Database.Database;
  private closed = false;

  /**
   * @param dbPath  Path to SQLite file (default: ./data/trust.db).
   *                Pass ':memory:' for testing.
   */
  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'trust.db');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Retrieve trust metrics for a single repo.
   */
  async getMetrics(repoName: string): Promise<RepoTrustMetrics | null> {
    this.assertOpen();

    const row = this.db
      .prepare('SELECT * FROM repo_trust WHERE repo_name = ?')
      .get(repoName) as Row | undefined;

    if (!row) return null;

    return this.toMetrics(row);
  }

  /**
   * Update trust metrics after a fix attempt completes.
   */
  async updateAfterFix(repoName: string, fixResult: FixResult): Promise<void> {
    this.assertOpen();

    const repoId = slugify(repoName);
    const now = new Date().toISOString();

    const existing = this.db
      .prepare('SELECT * FROM repo_trust WHERE repo_name = ?')
      .get(repoName) as Row | undefined;

    if (existing) {
      const newTotal = existing.total_fixes + 1;
      const newAcc = fixResult.success
        ? existing.accepted_fixes + 1
        : existing.accepted_fixes;
      const newRej = !fixResult.success
        ? existing.rejected_fixes + 1
        : existing.rejected_fixes;
      const newAvg = Math.round(
        (existing.avg_fix_time_ms * existing.total_fixes + fixResult.fixTimeMs) /
          newTotal,
      );

      this.db
        .prepare(
          `UPDATE repo_trust SET
            total_fixes = ?,
            accepted_fixes = ?,
            rejected_fixes = ?,
            total_test_pass = total_test_pass + ?,
            total_test_fail = total_test_fail + ?,
            total_gates_passed = total_gates_passed + ?,
            total_gates_failed = total_gates_failed + ?,
            avg_fix_time_ms = ?,
            last_updated = ?
          WHERE repo_name = ?`,
        )
        .run(
          newTotal,
          newAcc,
          newRej,
          fixResult.testPassCount,
          fixResult.testFailCount,
          fixResult.gatesPassed,
          fixResult.gatesFailed,
          newAvg,
          now,
          repoName,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO repo_trust (
            repo_id, repo_name,
            total_fixes, accepted_fixes, rejected_fixes,
            total_test_pass, total_test_fail,
            total_gates_passed, total_gates_failed,
            avg_fix_time_ms, last_updated
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          repoId,
          repoName,
          fixResult.success ? 1 : 0,
          !fixResult.success ? 1 : 0,
          fixResult.testPassCount,
          fixResult.testFailCount,
          fixResult.gatesPassed,
          fixResult.gatesFailed,
          fixResult.fixTimeMs,
          now,
        );
    }

    // Track failure reasons
    if (fixResult.failureReasons?.length) {
      const stmt = this.db.prepare(`
        INSERT INTO failure_reasons (repo_id, reason, count)
        VALUES (?, ?, 1)
        ON CONFLICT(repo_id, reason) DO UPDATE SET count = count + 1
      `);
      for (const reason of fixResult.failureReasons) {
        stmt.run(repoId, reason);
      }
    }
  }

  /**
   * Return repos sorted by accepted fix count (leaderboard).
   */
  async getLeaderboard(limit: number = 10): Promise<RepoTrustMetrics[]> {
    this.assertOpen();

    const rows = this.db
      .prepare('SELECT * FROM repo_trust ORDER BY accepted_fixes DESC LIMIT ?')
      .all(limit) as Row[];

    return rows.map((r) => this.toMetrics(r));
  }

  /** Close the database connection. */
  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private assertOpen(): void {
    if (this.closed) throw new Error('TrustStore is closed');
  }

  private toMetrics(row: Row): RepoTrustMetrics {
    const reasons = this.db
      .prepare(
        'SELECT reason, count FROM failure_reasons WHERE repo_id = ? ORDER BY count DESC',
      )
      .all(row.repo_id) as { reason: string; count: number }[];

    return {
      repoId: row.repo_id,
      repoName: row.repo_name,
      totalFixes: row.total_fixes,
      acceptedFixes: row.accepted_fixes,
      rejectedFixes: row.rejected_fixes,
      regressions7d: row.regressions_7d,
      totalTestPassCount: row.total_test_pass,
      totalTestFailCount: row.total_test_fail,
      totalGatesPassed: row.total_gates_passed,
      totalGatesFailed: row.total_gates_failed,
      averageFixTimeMs: row.avg_fix_time_ms,
      topFailureReasons: reasons,
      lastUpdated: new Date(row.last_updated),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal row shape
// ---------------------------------------------------------------------------

interface Row {
  repo_id: string;
  repo_name: string;
  total_fixes: number;
  accepted_fixes: number;
  rejected_fixes: number;
  regressions_7d: number;
  total_test_pass: number;
  total_test_fail: number;
  total_gates_passed: number;
  total_gates_failed: number;
  avg_fix_time_ms: number;
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}
