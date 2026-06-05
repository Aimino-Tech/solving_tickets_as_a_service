/**
 * UsageRepository — usage records and statistics.
 *
 * Tracks credits consumed per action (fix run, triage, sandbox, etc.).
 */

import { queryWithRetry } from '../connection.js';
import type { NewUsageRecord, UsageRecord } from '../schema/index.js';

export class UsageRepository {
  /**
   * Record a usage event.
   */
  async record(data: NewUsageRecord): Promise<UsageRecord> {
    const result = await queryWithRetry<UsageRecord>(
      `INSERT INTO usage_records (account_id, issue_id, repo, action, credits_used)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.accountId,
        data.issueId ?? null,
        data.repo ?? null,
        data.action,
        data.creditsUsed ?? 0,
      ],
    );
    return result.rows[0];
  }

  /**
   * Get total credits used by an account.
   */
  async totalCreditsUsed(accountId: number): Promise<number> {
    const result = await queryWithRetry<{ total: number }>(
      'SELECT COALESCE(SUM(credits_used), 0) AS total FROM usage_records WHERE account_id = $1',
      [accountId],
    );
    return result.rows[0]?.total ?? 0;
  }

  /**
   * Get credits used in a date range.
   */
  async creditsUsedInRange(
    accountId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const result = await queryWithRetry<{ total: number }>(
      `SELECT COALESCE(SUM(credits_used), 0) AS total
       FROM usage_records
       WHERE account_id = $1
         AND timestamp >= $2
         AND timestamp < $3`,
      [accountId, startDate.toISOString(), endDate.toISOString()],
    );
    return result.rows[0]?.total ?? 0;
  }

  /**
   * Get monthly usage statistics for an account.
   */
  async monthlyStats(accountId: number, months = 6) {
    const result = await queryWithRetry(
      `SELECT
         DATE_TRUNC('month', timestamp) AS month,
         action,
         SUM(credits_used) AS total_credits,
         COUNT(*) AS total_runs
       FROM usage_records
       WHERE account_id = $1
         AND timestamp >= DATE_TRUNC('month', NOW()) - ($2 || ' months')::INTERVAL
       GROUP BY DATE_TRUNC('month', timestamp), action
       ORDER BY month DESC, action`,
      [accountId, months],
    );
    return result.rows;
  }

  /**
   * List usage records for an account (paginated).
   */
  async listByAccount(accountId: number, limit = 50, offset = 0): Promise<UsageRecord[]> {
    const result = await queryWithRetry<UsageRecord>(
      `SELECT * FROM usage_records
       WHERE account_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );
    return result.rows;
  }
}

export const usageRepository = new UsageRepository();
