/**
 * TeamsRepository — team management for multi-tenant accounts.
 */

import { queryWithRetry } from '../connection.js';
import type { Team, NewTeam } from '../schema/index.js';

export class TeamsRepository {
  /**
   * Create a new team.
   */
  async create(data: NewTeam): Promise<Team> {
    const result = await queryWithRetry<Team>(
      `INSERT INTO teams (name, account_ids)
       VALUES ($1, $2)
       RETURNING *`,
      [data.name, data.accountIds ?? []],
    );
    return result.rows[0];
  }

  /**
   * Find a team by its ID.
   */
  async findById(id: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams WHERE id = $1', [id]);
    return result.rows[0];
  }

  /**
   * List all teams for a given account (where account_id is in the team's account_ids array).
   */
  async listByAccount(accountId: number): Promise<Team[]> {
    const result = await queryWithRetry<Team>(
      'SELECT * FROM teams WHERE $1 = ANY(account_ids) ORDER BY name',
      [accountId],
    );
    return result.rows;
  }

  /**
   * Add an account to a team.
   */
  async addMember(teamId: number, accountId: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>(
      `UPDATE teams
       SET account_ids = ARRAY(
         SELECT DISTINCT unnest(account_ids || $2::int[])
       )
       WHERE id = $1
       RETURNING *`,
      [teamId, [accountId]],
    );
    return result.rows[0];
  }

  /**
   * Remove an account from a team.
   */
  async removeMember(teamId: number, accountId: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>(
      `UPDATE teams
       SET account_ids = ARRAY(
         SELECT unnest(account_ids) WHERE unnest <> $2
       )
       WHERE id = $1
       RETURNING *`,
      [teamId, accountId],
    );
    return result.rows[0];
  }

  /**
   * Update team name.
   */
  async update(id: number, data: Partial<Pick<Team, 'name'>>): Promise<Team | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const result = await queryWithRetry<Team>(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  /**
   * Delete a team.
   */
  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM teams WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * List all teams (paginated).
   */
  async list(limit = 50, offset = 0): Promise<Team[]> {
    const result = await queryWithRetry<Team>(
      'SELECT * FROM teams ORDER BY name LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return result.rows;
  }
}

export const teamsRepository = new TeamsRepository();
