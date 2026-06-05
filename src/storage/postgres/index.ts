/**
 * Postgres storage backend for persistent run history.
 *
 * Wraps the existing Postgres connection pool (`getPool` / `queryWithRetry`)
 * with the `StorageBackend` interface.  The table schema mirrors `RunRecord`
 * and is auto-created on first use via a `CREATE TABLE IF NOT EXISTS`
 * statement.
 *
 * In production, run the Drizzle migration (`npm run db:migrate`) which uses
 * the formal schema definition at `src/db/schema/runHistory.ts`.  The
 * auto-create here is a convenience for development/testing.
 */

import type { RunRecord, RunFilter, RunStats, StorageBackend } from '../types.js';
import { queryWithRetry } from '../../db/connection.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'storage:postgres' });

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS run_history (
  id              SERIAL PRIMARY KEY,
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms     INTEGER,
  model_used      TEXT
)
`;

// ---------------------------------------------------------------------------
// Row mapping
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
    status: row.status as RunRecord['status'],
    confidence: row.confidence ?? undefined,
    summary: row.summary ?? undefined,
    prUrl: row.pr_url ?? undefined,
    branchName: row.branch_name ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    durationMs: row.duration_ms ?? undefined,
    modelUsed: row.model_used ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// PostgresStorage
// ---------------------------------------------------------------------------

export class PostgresStorage implements StorageBackend {
  private initialized = false;

  /** Ensure the run_history table exists. Idempotent. */
  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await queryWithRetry(CREATE_TABLE_SQL);
    this.initialized = true;
    log.info('Postgres run_history schema ensured');
  }

  // -----------------------------------------------------------------------
  // StorageBackend implementation
  // -----------------------------------------------------------------------

  async saveRun(run: RunRecord): Promise<RunRecord> {
    await this.ensureTable();

    const result = await queryWithRetry<DbRow>(
      `INSERT INTO run_history
         (installation_id, repo_owner, repo_name, issue_number, status,
          confidence, summary, pr_url, branch_name, error, duration_ms, model_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        run.installationId,
        run.repoOwner,
        run.repoName,
        run.issueNumber,
        run.status,
        run.confidence ?? null,
        run.summary ?? null,
        run.prUrl ?? null,
        run.branchName ?? null,
        run.error ?? null,
        run.durationMs ?? null,
        run.modelUsed ?? null,
      ],
    );

    return rowToRecord(result.rows[0]);
  }

  async getRun(runId: string | number): Promise<RunRecord | undefined> {
    await this.ensureTable();

    const id = typeof runId === 'string' ? Number.parseInt(runId, 10) : runId;
    const result = await queryWithRetry<DbRow>(
      'SELECT * FROM run_history WHERE id = $1',
      [id],
    );

    return result.rows[0] ? rowToRecord(result.rows[0]) : undefined;
  }

  async listRuns(filter: RunFilter): Promise<RunRecord[]> {
    await this.ensureTable();

    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.repo) {
      const parts = filter.repo.split('/');
      if (parts.length === 2) {
        conditions.push(`repo_owner = $${paramIdx++} AND repo_name = $${paramIdx++}`);
        params.push(parts[0], parts[1]);
      } else {
        conditions.push(`repo_owner || '/' || repo_name = $${paramIdx++}`);
        params.push(filter.repo);
      }
    }

    if (filter.issueNumber !== undefined) {
      conditions.push(`issue_number = $${paramIdx++}`);
      params.push(filter.issueNumber);
    }

    if (filter.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(filter.status);
    }

    if (filter.startDate) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filter.startDate.toISOString());
    }

    if (filter.endDate) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(filter.endDate.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM run_history ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await queryWithRetry<DbRow>(sql, params);
    return result.rows.map(rowToRecord);
  }

  async getRunStats(filter: RunFilter): Promise<RunStats> {
    await this.ensureTable();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.repo) {
      const parts = filter.repo.split('/');
      if (parts.length === 2) {
        conditions.push(`repo_owner = $${paramIdx++} AND repo_name = $${paramIdx++}`);
        params.push(parts[0], parts[1]);
      } else {
        conditions.push(`repo_owner || '/' || repo_name = $${paramIdx++}`);
        params.push(filter.repo);
      }
    }

    if (filter.issueNumber !== undefined) {
      conditions.push(`issue_number = $${paramIdx++}`);
      params.push(filter.issueNumber);
    }

    if (filter.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(filter.status);
    }

    if (filter.startDate) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filter.startDate.toISOString());
    }

    if (filter.endDate) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(filter.endDate.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        COUNT(*)                                              AS total,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0 END), 0)::float AS pass_rate,
        COALESCE(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0)::float AS avg_duration_ms
      FROM run_history ${where}
    `;

    const result = await queryWithRetry<{
      total: number;
      pass_rate: number;
      avg_duration_ms: number;
    }>(sql, params);

    const row = result.rows[0];
    return {
      total: Number(row.total),
      passRate: Number(row.pass_rate),
      avgDurationMs: Math.round(Number(row.avg_duration_ms)),
    };
  }

  /** Release the database connection pool. */
  async close(): Promise<void> {
    const { closePool } = await import('../../db/connection.js');
    await closePool();
    log.info('Postgres storage closed');
  }
}
