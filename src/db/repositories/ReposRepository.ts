/**
 * Repos repository — data access for the repos table.
 */

import { queryWithRetry } from '../connection.js';
import type { Repo, NewRepo } from '../schema/index.js';

export class ReposRepository {
  async findById(id: number): Promise<Repo | undefined> {
    const result = await queryWithRetry<Repo>('SELECT * FROM repos WHERE id = $1', [id]);
    return result.rows[0];
  }

  async findByOwnerAndName(owner: string, name: string): Promise<Repo | undefined> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE owner = $1 AND name = $2',
      [owner, name],
    );
    return result.rows[0];
  }

  async findByAccountId(accountId: number): Promise<Repo[]> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE account_id = $1 ORDER BY id DESC',
      [accountId],
    );
    return result.rows;
  }

  async findByInstallationId(installationId: number): Promise<Repo[]> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE installation_id = $1 ORDER BY id DESC',
      [installationId],
    );
    return result.rows;
  }

  async findByInstallationOwnerAndName(
    installationId: number,
    owner: string,
    name: string,
  ): Promise<Repo | undefined> {
    const result = await queryWithRetry<Repo>(
      'SELECT * FROM repos WHERE installation_id = $1 AND owner = $2 AND name = $3',
      [installationId, owner, name],
    );
    return result.rows[0];
  }

  async create(data: NewRepo): Promise<Repo> {
    const result = await queryWithRetry<Repo>(
      `INSERT INTO repos (owner, name, installation_id, account_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.owner, data.name, data.installationId, data.accountId],
    );
    return result.rows[0];
  }

  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM repos WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async list(limit = 50, offset = 0): Promise<Repo[]> {
    const result = await queryWithRetry<Repo>('SELECT * FROM repos ORDER BY id DESC LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]);
    return result.rows;
  }
}

export const reposRepository = new ReposRepository();
