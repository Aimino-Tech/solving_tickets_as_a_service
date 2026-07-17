/**
 * UsageStore — SQLite-backed usage tracking for STAS.
 *
 * Tracks individual usage records and monthly aggregate counters
 * per user + repository combination.
 */

import Database from 'better-sqlite3';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecordRow {
  id: number;
  userId: string;
  repoId: string;
  action: string;
  tierAtTime: string;
  timestamp: string;
  metadataJson: string | null;
}

export interface MonthlyCounterRow {
  id: number;
  userId: string;
  repoId: string;
  yearMonth: string; // "YYYY-MM"
  fixCount: number;
}

export interface MonthlyUsage {
  yearMonth: string;
  fixCount: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  repo_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  tier_at_time TEXT NOT NULL DEFAULT 'cloud-free',
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_repo
  ON usage_records(user_id, repo_id);

CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp
  ON usage_records(timestamp);

CREATE TABLE IF NOT EXISTS usage_monthly (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  repo_id    TEXT NOT NULL,
  year_month TEXT NOT NULL,
  fix_count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, repo_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_usage_monthly_lookup
  ON usage_monthly(user_id, repo_id, year_month);
`;

// ---------------------------------------------------------------------------
// UsageStore
// ---------------------------------------------------------------------------

export class UsageStore {
  private db: Database.Database;
  private closed = false;

  /**
   * @param dbPath  Path to SQLite file (default: ./data/usage.db).
   *                Pass ':memory:' for testing.
   */
  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'usage.db');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record a single usage event.
   * Returns the inserted row id.
   */
  record(
    userId: string,
    repoId: string,
    action: string,
    tierAtTime: string,
    metadata?: Record<string, unknown>,
  ): number {
    this.assertOpen();

    const result = this.db
      .prepare(
        `INSERT INTO usage_records (user_id, repo_id, action, tier_at_time, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, repoId, action, tierAtTime, metadata ? JSON.stringify(metadata) : null);

    return Number(result.lastInsertRowid);
  }

  /**
   * Increment the monthly fix counter for a user + repo combination.
   * Creates the row if it does not exist.
   */
  incrementMonthly(userId: string, repoId: string, yearMonth: string): void {
    this.assertOpen();

    this.db
      .prepare(
        `INSERT INTO usage_monthly (user_id, repo_id, year_month, fix_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(user_id, repo_id, year_month)
         DO UPDATE SET fix_count = fix_count + 1`,
      )
      .run(userId, repoId, yearMonth);
  }

  /**
   * Get the monthly fix count for a user + repo in a given month.
   * Returns 0 if no records exist.
   */
  getMonthlyCount(userId: string, repoId: string, yearMonth: string): number {
    this.assertOpen();

    const row = this.db
      .prepare(
        'SELECT fix_count FROM usage_monthly WHERE user_id = ? AND repo_id = ? AND year_month = ?',
      )
      .get(userId, repoId, yearMonth) as { fix_count: number } | undefined;

    return row?.fix_count ?? 0;
  }

  /**
   * Get the full usage history for a user across all repos.
   */
  getUserUsage(userId: string): MonthlyUsage[] {
    this.assertOpen();

    const rows = this.db
      .prepare(
        `SELECT year_month, SUM(fix_count) as fix_count
         FROM usage_monthly
         WHERE user_id = ?
         GROUP BY year_month
         ORDER BY year_month DESC`,
      )
      .all(userId) as Array<{ year_month: string; fix_count: number }>;

    return rows.map(mapMonthlyRow);
  }

  /**
   * Get monthly usage for a specific user + repo.
   */
  getRepoUsage(userId: string, repoId: string): MonthlyUsage[] {
    this.assertOpen();

    const rows = this.db
      .prepare(
        'SELECT year_month, fix_count FROM usage_monthly WHERE user_id = ? AND repo_id = ? ORDER BY year_month DESC',
      )
      .all(userId, repoId) as Array<{ year_month: string; fix_count: number }>;

    return rows.map(mapMonthlyRow);
  }

  /**
   * Get the total fix count for the current month for a user + repo.
   * Uses UTC date for consistency.
   */
  getCurrentMonthCount(userId: string, repoId: string): number {
    const yearMonth = currentYearMonth();
    return this.getMonthlyCount(userId, repoId, yearMonth);
  }

  /**
   * Get the timestamp of the earliest reset time (next month start)
   * for a user + repo's current usage period.
   */
  getResetTimestamp(userId: string, repoId: string): string {
    const nextMonth = nextMonthStart();
    return nextMonth.toISOString();
  }

  /** Close the database connection. */
  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  /**
   * Delete all data (for testing).
   */
  clear(): void {
    this.assertOpen();
    this.db.exec('DELETE FROM usage_records; DELETE FROM usage_monthly;');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private assertOpen(): void {
    if (this.closed) throw new Error('UsageStore is closed');
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Map a snake_case DB row to a camelCase MonthlyUsage object.
 */
function mapMonthlyRow(row: { year_month: string; fix_count: number }): MonthlyUsage {
  return { yearMonth: row.year_month, fixCount: row.fix_count };
}

/**
 * Get the current year-month string in UTC (e.g. "2026-07").
 */
export function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Get the start of the next month in UTC.
 */
export function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
