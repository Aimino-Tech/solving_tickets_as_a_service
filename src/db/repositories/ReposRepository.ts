/**
 * ReposRepository — repository tracking per account.
 */

import { queryWithRetry } from '../connection.js';
import type { Repo, NewRepo } from '../schema/index.js';

export class ReposRepository {
  /**
   * Create a new repo record.
   */
  async create(data: NewRepo): Promise<Repo> {
    const result = await queryWithRetry<Repo>(
      `INSERT INTO repos (owner, name, installation_id, account_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.owner, data.name, data.installationId, data.accountId],
    );
    return result.rows[0];
  }

  /**
   * Find a repo by its ID.
   */
  async findById(id: number): Promise<Repo | undefined> {
    const result = await queryWithRetry<Repo>('SELECT * FROM repos WHERE id = $1', [id]);
    return result.rows[0];
  }

  /**
   * Find a repo by owner/name and account.
   */
  async findByOwnerAndName(owner: string, name: string, accountId: number): Promise<Repo | undefined> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE owner = $1 AND name = $2 AND account_id = $3',
      [owner, name, accountId],
    );
    return result.rows[0];
  }

  /**
   * List repos for an account (paginated).
   */
  async listByAccount(accountId: number, limit = 50, offset = 0): Promise<Repo[]> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE account_id = $1 ORDER BY enabled_at DESC LIMIT $2 OFFSET $3',
      [accountId, limit, offset],
    );
    return result.rows;
  }

  /**
   * List repos by installation ID.
   */
  async listByInstallation(installationId: number): Promise<Repo[]> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE installation_id = $1 ORDER BY enabled_at DESC',
      [installationId],
    );
    return result.rows;
  }

  /**
   * Delete a repo record.
   */
  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM repos WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * List all repos (paginated, admin use).
   */
  async list(limit = 50, offset = 0): Promise<Repo[]> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos ORDER BY enabled_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return result.rows;
  }
}

export const reposRepository = new ReposRepository();
