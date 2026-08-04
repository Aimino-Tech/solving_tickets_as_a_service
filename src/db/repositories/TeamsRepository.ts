/**
 * Teams repository — data access for the teams table.
 */

import { randomUUID } from 'node:crypto';
import { queryWithRetry, validateSqlIdentifier } from '../connection.js';
import type { Team, NewTeam, TeamMember, NewTeamMember } from '../types/index.js';

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

    // Validate each column name in the dynamic SET clause
    for (const clause of sets) {
      const colName = clause.split('=')[0].trim();
      validateSqlIdentifier(colName);
    }

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

  /**
   * Set or clear a member's monthly credit limit.
   * Passing null clears the limit (unlimited).
   */
  async setMemberMonthlyLimit(
    teamId: number,
    accountId: number,
    monthlyLimitCredits: number | null,
  ): Promise<TeamMember | undefined> {
    const result = await queryWithRetry<TeamMember>(
      `INSERT INTO team_members (team_id, account_id, role, monthly_limit_credits)
       VALUES ($1, $2, 'member', $3)
       ON CONFLICT (team_id, account_id)
       DO UPDATE SET monthly_limit_credits = $3
       RETURNING *`,
      [teamId, accountId, monthlyLimitCredits],
    );
    return result.rows[0];
  }

  /**
   * Members joined with account email/name, ordered by join date.
   */
  async getMembersWithDetails(
    teamId: number,
  ): Promise<(TeamMember & { accountEmail?: string; accountName?: string })[]> {
    const result = await queryWithRetry<
      TeamMember & { account_email: string | null; account_name: string | null }
    >(
      `SELECT tm.*, a.email AS account_email, a.name AS account_name
       FROM team_members tm
       LEFT JOIN accounts a ON a.id = tm.account_id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at`,
      [teamId],
    );
    return result.rows.map((row) => ({
      ...row,
      accountEmail: row.account_email ?? undefined,
      accountName: row.account_name ?? undefined,
    }));
  }

  /**
   * Pending (not yet accepted/revoked) invites scoped to a team.
   */
  async getPendingInvites(
    teamId: number,
  ): Promise<{ id: number; email: string; role: string; monthlyLimitCredits: number | null; createdAt: Date }[]> {
    const result = await queryWithRetry<{
      id: number;
      email: string;
      role: string;
      monthly_limit_credits: number | null;
      created_at: Date;
    }>(
      `SELECT id, email, role, monthly_limit_credits, created_at
       FROM invites
       WHERE team_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [teamId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      monthlyLimitCredits: row.monthly_limit_credits,
      createdAt: row.created_at,
    }));
  }

  /**
   * Revoke a pending invite by id within a team.
   */
  async revokeInvite(teamId: number, inviteId: number): Promise<boolean> {
    const result = await queryWithRetry(
      `UPDATE invites SET status = 'revoked'
       WHERE id = $1 AND team_id = $2 AND status = 'pending'`,
      [inviteId, teamId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Create a pending email invite scoped to a team.
   * Returns undefined when an invite for this email is already pending/accepted.
   */
  async createInvite(data: {
    teamId: number;
    email: string;
    invitedBy: string;
    role?: string;
    monthlyLimitCredits?: number | null;
  }): Promise<{ id: number; email: string; token: string } | undefined> {
    const result = await queryWithRetry<{ id: number; email: string; token: string }>(
      `INSERT INTO invites (email, invited_by, role, token, status, team_id, monthly_limit_credits)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, token`,
      [data.email, data.invitedBy, data.role ?? 'member', randomUUID(), data.teamId, data.monthlyLimitCredits ?? null],
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
