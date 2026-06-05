/**
 * Teams repository — data access for the teams table.
 */

import { queryWithRetry } from '../connection.js';
import type { Team, NewTeam } from '../schema/index.js';

export class TeamsRepository {
  async findById(id: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams WHERE id = $1', [id]);
    return result.rows[0];
  }

  async findByAccountId(accountId: number): Promise<Team[]> {
    const result = await queryWithRetry<Team>(
      'SELECT * FROM teams WHERE $1 = ANY(account_ids) ORDER BY id DESC',
      [accountId],
    );
    return result.rows;
  }

  async findByName(name: string): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams WHERE name = $1', [name]);
    return result.rows[0];
  }

  async create(data: NewTeam): Promise<Team> {
    const result = await queryWithRetry<Team>(
      `INSERT INTO teams (name, account_ids)
       VALUES ($1, $2)
       RETURNING *`,
      [data.name, data.accountIds ?? []],
    );
    return result.rows[0];
  }

  async addAccount(teamId: number, accountId: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>(
      `UPDATE teams
       SET account_ids = array_append(account_ids, $1)
       WHERE id = $2 AND NOT ($1 = ANY(account_ids))
       RETURNING *`,
      [accountId, teamId],
    );
    return result.rows[0];
  }

  async removeAccount(teamId: number, accountId: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>(
      `UPDATE teams
       SET account_ids = array_remove(account_ids, $1)
       WHERE id = $2
       RETURNING *`,
      [accountId, teamId],
    );
    return result.rows[0];
  }

  async updateName(id: number, name: string): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>(
      'UPDATE teams SET name = $1 WHERE id = $2 RETURNING *',
      [name, id],
    );
    return result.rows[0];
  }

  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM teams WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async list(limit = 50, offset = 0): Promise<Team[]> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams ORDER BY id DESC LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]);
    return result.rows;
  }
}

export const teamsRepository = new TeamsRepository();
