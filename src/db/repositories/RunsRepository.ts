/**
 * RunsRepository — detailed fix-run records with full metadata.
 *
 * This is the new runs table (separate from legacy run_history).
 * Tracks every automated fix from start to completion with
 * confidence scores, PR URLs, duration, and model info.
 */

import { queryWithRetry, validateSqlIdentifier, isTableNotFoundError, isDatabaseConnectionError } from '../connection.js';
import type { Run, NewRun } from '../types/index.js';

export interface RunFilter {
  accountId?: number;
  repoId?: number;
  issueNumber?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export class RunsRepository {
  /**
   * Create a new run record.
   */
  async create(data: NewRun): Promise<Run> {
    const result = await queryWithRetry<Run>(
      `INSERT INTO runs (account_id, repo_id, issue_number, status, confidence, summary, pr_url, branch_name, error, duration_ms, model_used, credits_used, cost_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        data.accountId,
        data.repoId ?? null,
        data.issueNumber ?? null,
        data.status ?? 'pending',
        data.confidence ?? null,
        data.summary ?? null,
        data.prUrl ?? null,
        data.branchName ?? null,
        data.error ?? null,
        data.durationMs ?? null,
        data.modelUsed ?? null,
        data.creditsUsed ?? null,
        data.costCents ?? null,
      ],
    );
    return result.rows[0];
  }

  /**
   * Find a run by its ID.
   */
  async findById(id: number): Promise<Run | undefined> {
    const result = await queryWithRetry<Run>('SELECT * FROM runs WHERE id = $1', [id]);
    return result.rows[0];
  }

  /**
   * Update run status and related fields.
   */
  async update(id: number, data: Partial<Pick<Run,
    'status' | 'confidence' | 'summary' | 'prUrl' | 'branchName' | 'error' | 'durationMs' | 'modelUsed' | 'creditsUsed' | 'costCents'
  >>): Promise<Run | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.confidence !== undefined) { sets.push(`confidence = $${idx++}`); values.push(data.confidence); }
    if (data.summary !== undefined) { sets.push(`summary = $${idx++}`); values.push(data.summary); }
    if (data.prUrl !== undefined) { sets.push(`pr_url = $${idx++}`); values.push(data.prUrl); }
    if (data.branchName !== undefined) { sets.push(`branch_name = $${idx++}`); values.push(data.branchName); }
    if (data.error !== undefined) { sets.push(`error = $${idx++}`); values.push(data.error); }
    if (data.durationMs !== undefined) { sets.push(`duration_ms = $${idx++}`); values.push(data.durationMs); }
    if (data.modelUsed !== undefined) { sets.push(`model_used = $${idx++}`); values.push(data.modelUsed); }
    if (data.creditsUsed !== undefined) { sets.push(`credits_used = $${idx++}`); values.push(data.creditsUsed); }
    if (data.costCents !== undefined) { sets.push(`cost_cents = $${idx++}`); values.push(data.costCents); }

    if (sets.length === 0) return this.findById(id);

    // Validate each column name in the dynamic SET clause
    for (const clause of sets) {
      const colName = clause.split('=')[0].trim();
      validateSqlIdentifier(colName);
    }

    values.push(id);
    const result = await queryWithRetry<Run>(
      `UPDATE runs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  /**
   * List runs with optional filtering, newest first.
   */
  async list(filter: RunFilter = {}): Promise<Run[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.accountId !== undefined) {
      conditions.push(`account_id = $${idx++}`);
      params.push(filter.accountId);
    }
    if (filter.repoId !== undefined) {
      conditions.push(`repo_id = $${idx++}`);
      params.push(filter.repoId);
    }
    if (filter.issueNumber !== undefined) {
      conditions.push(`issue_number = $${idx++}`);
      params.push(filter.issueNumber);
    }
    if (filter.status !== undefined) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    try {
      const result = await queryWithRetry<Run>(sql, params);
      return result.rows;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Get the latest run for a specific issue.
   */
  async latestForIssue(accountId: number, issueNumber: number): Promise<Run | undefined> {
    const result = await queryWithRetry<Run>(
      'SELECT * FROM runs WHERE account_id = $1 AND issue_number = $2 ORDER BY created_at DESC LIMIT 1',
      [accountId, issueNumber],
    );
    return result.rows[0];
  }

  /**
   * Get run statistics for an account.
   */
  async stats(accountId: number): Promise<{
    total: number;
    completed: number;
    failed: number;
    passRate: number;
  }> {
    const result = await queryWithRetry<{
      total: number;
      completed: number;
      failed: number;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed
       FROM runs WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    return {
      total: Number(row.total),
      completed: Number(row.completed),
      failed: Number(row.failed),
      passRate: row.total > 0 ? Number(row.completed) / Number(row.total) : 0,
    };
  }
}

export const runsRepository = new RunsRepository();
