/**
 * RunHistoryRepository — fix run records.
 *
 * Tracks every fix run from start to completion.
 */

import { queryWithRetry } from '../connection.js';
import type { NewRunHistory, RunHistory } from '../schema/index.js';

export class RunHistoryRepository {
  /**
   * Create a new run history entry (status = 'pending').
   */
  async create(data: NewRunHistory): Promise<RunHistory> {
    const result = await queryWithRetry<RunHistory>(
      `INSERT INTO run_history (account_id, issue_id, repo, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.accountId, data.issueId ?? null, data.repo ?? null, data.status ?? 'pending'],
    );
    return result.rows[0];
  }

  /**
   * Mark a run as started.
   */
  async markStarted(id: number): Promise<RunHistory | undefined> {
    const result = await queryWithRetry<RunHistory>(
      `UPDATE run_history
       SET status = 'running', started_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  /**
   * Mark a run as completed successfully.
   */
  async markCompleted(id: number, resultData?: string): Promise<RunHistory | undefined> {
    const result = await queryWithRetry<RunHistory>(
      `UPDATE run_history
       SET status = 'completed', completed_at = NOW(), result = $2
       WHERE id = $1
       RETURNING *`,
      [id, resultData ?? null],
    );
    return result.rows[0];
  }

  /**
   * Mark a run as failed.
   */
  async markFailed(id: number, errorDetails?: string): Promise<RunHistory | undefined> {
    const result = await queryWithRetry<RunHistory>(
      `UPDATE run_history
       SET status = 'failed', completed_at = NOW(), result = $2
       WHERE id = $1
       RETURNING *`,
      [id, errorDetails ?? null],
    );
    return result.rows[0];
  }

  /**
   * Cancel a run.
   */
  async markCancelled(id: number): Promise<RunHistory | undefined> {
    const result = await queryWithRetry<RunHistory>(
      `UPDATE run_history
       SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  /**
   * Find a run by its ID.
   */
  async findById(id: number): Promise<RunHistory | undefined> {
    const result = await queryWithRetry<RunHistory>('SELECT * FROM run_history WHERE id = $1', [id]);
    return result.rows[0];
  }

  /**
   * List runs for an account (paginated, newest first).
   */
  async listByAccount(accountId: number, limit = 50, offset = 0): Promise<RunHistory[]> {
    const result = await queryWithRetry<RunHistory>(
      `SELECT * FROM run_history
       WHERE account_id = $1
       ORDER BY COALESCE(started_at, created_at) DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );
    return result.rows;
  }

  /**
   * Get the latest run for an issue.
   */
  async latestForIssue(accountId: number, issueId: number): Promise<RunHistory | undefined> {
    const result = await queryWithRetry<RunHistory>(
      `SELECT * FROM run_history
       WHERE account_id = $1 AND issue_id = $2
       ORDER BY COALESCE(started_at, created_at) DESC
       LIMIT 1`,
      [accountId, issueId],
    );
    return result.rows[0];
  }
}

export const runHistoryRepository = new RunHistoryRepository();
