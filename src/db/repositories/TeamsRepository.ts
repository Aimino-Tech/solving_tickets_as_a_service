/**
 * Teams repository — data access for the teams table.
 */

import { queryWithRetry } from '../connection.js';
import type { Team, NewTeam, TeamMember, NewTeamMember } from '../schema/index.js';

export class TeamsRepository {
  async findById(id: number): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams WHERE id = $1', [id]);
    return result.rows[0];
  }

  async findByName(name: string): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams WHERE name = $1', [name]);
    return result.rows[0];
  }

  async findBySlug(slug: string): Promise<Team | undefined> {
    const result = await queryWithRetry<Team>('SELECT * FROM teams WHERE slug = $1', [slug]);
    return result.rows[0];
  }

  async create(data: NewTeam): Promise<Team> {
    const result = await queryWithRetry<Team>(
      `INSERT INTO teams (name, slug, owner_account_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.slug, data.ownerAccountId],
    );
    return result.rows[0];
  }

  async update(id: number, data: Partial<Pick<Team, 'name' | 'slug'>>): Promise<Team | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.slug !== undefined) {
      sets.push(`slug = $${idx++}`);
      values.push(data.slug);
    }

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const result = await queryWithRetry<Team>(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
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

  async addMember(teamId: number, accountId: number, role = 'member'): Promise<TeamMember> {
    const result = await queryWithRetry<TeamMember>(
      `INSERT INTO team_members (team_id, account_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, account_id)
       DO UPDATE SET role = $3
       RETURNING *`,
      [teamId, accountId, role],
    );
    return result.rows[0];
  }

  async removeMember(teamId: number, accountId: number): Promise<boolean> {
    const result = await queryWithRetry(
      'DELETE FROM team_members WHERE team_id = $1 AND account_id = $2',
      [teamId, accountId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getMembers(teamId: number): Promise<TeamMember[]> {
    const result = await queryWithRetry<TeamMember>(
      'SELECT * FROM team_members WHERE team_id = $1 ORDER BY joined_at',
      [teamId],
    );
    return result.rows;
  }

  async getTeamsForAccount(accountId: number): Promise<Team[]> {
    const result = await queryWithRetry<Team>(
      `SELECT t.* FROM teams t
       INNER JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.account_id = $1
       ORDER BY t.name`,
      [accountId],
    );
    return result.rows;
  }
}

export const teamsRepository = new TeamsRepository();
