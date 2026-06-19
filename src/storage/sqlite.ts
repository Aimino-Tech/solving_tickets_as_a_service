/**
 * SQLite storage backend for persistent run history.
 *
 * Uses `better-sqlite3` (synchronous API) for local / OSS / self-hosted
 * deployments.  The database file path is read from the config object.
 *
 * Schema is auto-created on first connection via a `CREATE TABLE IF NOT EXISTS`
 * statement so no separate migration step is needed.
 */

import Database from 'better-sqlite3';
import type { RunRecord, RunFilter, RunStats } from './types.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'storage:sqlite' });

// ---------------------------------------------------------------------------
// Helpers — map between snake_case DB columns and camelCase RunRecord fields
// ---------------------------------------------------------------------------

interface DbRow {
  id: number;
  installation_id: number;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  status: string;
  confidence: string | null;
  summary: string | null;
  pr_url: string | null;
  branch_name: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  duration_ms: number | null;
  model_used: string | null;
}

function rowToRecord(row: DbRow): RunRecord {
  return {
    id: row.id,
    installationId: row.installation_id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    issueNumber: row.issue_number,
    status: row.status,
    confidence: row.confidence ?? undefined,
    summary: row.summary ?? undefined,
    prUrl: row.pr_url ?? undefined,
    branchName: row.branch_name ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at + 'Z') : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at + 'Z') : undefined,
    durationMs: row.duration_ms ?? undefined,
    modelUsed: row.model_used ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS run_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  repo_owner      TEXT NOT NULL,
  repo_name       TEXT NOT NULL,
  issue_number    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  confidence      TEXT,
  summary         TEXT,
  pr_url          TEXT,
  branch_name     TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms     INTEGER,
  model_used      TEXT
)
`;

// ---------------------------------------------------------------------------
// SQLiteStorage
// ---------------------------------------------------------------------------

export class SQLiteStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    log.info({ dbPath }, 'Opening SQLite database');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(CREATE_TABLE_SQL);
    log.info('SQLite schema ensured');
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
    log.info('SQLite database closed');
  }

  // -----------------------------------------------------------------------
  // StorageBackend implementation
  // -----------------------------------------------------------------------

  saveRun(run: RunRecord): Promise<RunRecord> {
    const stmt = this.db.prepare(`
      INSERT INTO run_history
        (installation_id, repo_owner, repo_name, issue_number, status,
         confidence, summary, pr_url, branch_name, error, duration_ms, model_used)
      VALUES
        (@installationId, @repoOwner, @repoName, @issueNumber, @status,
         @confidence, @summary, @prUrl, @branchName, @error, @durationMs, @modelUsed)
      RETURNING *
    `);

    const row = stmt.get({
      installationId: run.installationId,
      repoOwner: run.repoOwner,
      repoName: run.repoName,
      issueNumber: run.issueNumber,
      status: run.status,
      confidence: run.confidence ?? null,
      summary: run.summary ?? null,
      prUrl: run.prUrl ?? null,
      branchName: run.branchName ?? null,
      error: run.error ?? null,
      durationMs: run.durationMs ?? null,
      modelUsed: run.modelUsed ?? null,
    }) as DbRow | undefined;

    if (!row) {
      throw new Error('SQLite saveRun returned no row');
    }

    return Promise.resolve(rowToRecord(row));
  }

  getRun(runId: string | number): Promise<RunRecord | undefined> {
    const id = typeof runId === 'string' ? Number.parseInt(runId, 10) : runId;
    const stmt = this.db.prepare('SELECT * FROM run_history WHERE id = ?');
    const row = stmt.get(id) as DbRow | undefined;
    return Promise.resolve(row ? rowToRecord(row) : undefined);
  }

  listRuns(filter: RunFilter): Promise<RunRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.repo) {
      const parts = filter.repo.split('/');
      if (parts.length === 2) {
        conditions.push('repo_owner = ? AND repo_name = ?');
        params.push(parts[0], parts[1]);
      } else {
        conditions.push('(repo_owner || \'/\' || repo_name) = ?');
        params.push(filter.repo);
      }
    }

    if (filter.issueNumber !== undefined) {
      conditions.push('issue_number = ?');
      params.push(filter.issueNumber);
    }

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.startDate) {
      conditions.push('created_at >= ?');
      params.push(filter.startDate.toISOString().replace('Z', ''));
    }

    if (filter.endDate) {
      conditions.push('created_at <= ?');
      params.push(filter.endDate.toISOString().replace('Z', ''));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM run_history ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as DbRow[];
    return Promise.resolve(rows.map(rowToRecord));
  }

  getRunStats(filter: RunFilter): Promise<RunStats> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.repo) {
      const parts = filter.repo.split('/');
      if (parts.length === 2) {
        conditions.push('repo_owner = ? AND repo_name = ?');
        params.push(parts[0], parts[1]);
      } else {
        conditions.push('(repo_owner || \'/\' || repo_name) = ?');
        params.push(filter.repo);
      }
    }

    if (filter.issueNumber !== undefined) {
      conditions.push('issue_number = ?');
      params.push(filter.issueNumber);
    }

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.startDate) {
      conditions.push('created_at >= ?');
      params.push(filter.startDate.toISOString().replace('Z', ''));
    }

    if (filter.endDate) {
      conditions.push('created_at <= ?');
      params.push(filter.endDate.toISOString().replace('Z', ''));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        COUNT(*)                                              AS total,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0 END), 0) AS pass_rate,
        COALESCE(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE NULL END), 0) AS avg_duration_ms
      FROM run_history ${where}
    `;

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as { total: number; pass_rate: number; avg_duration_ms: number } | undefined;

    if (!row) {
      return Promise.resolve({ total: 0, passRate: 0, avgDurationMs: 0 });
    }

    return Promise.resolve({
      total: row.total,
      passRate: row.pass_rate,
      avgDurationMs: Math.round(row.avg_duration_ms),
    });
  }
}
