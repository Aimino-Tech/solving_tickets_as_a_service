import { queryWithRetry } from '../connection.js';
import type { Workspace, NewWorkspace } from '../types/index.js';

export class WorkspaceRepository {
  async create(data: NewWorkspace): Promise<Workspace> {
    const result = await queryWithRetry<Workspace>(
      `INSERT INTO workspaces (name, tenant_id, plan_id, seats, status, slack_team_id, slack_bot_token, slack_channel, github_installation_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        data.name,
        data.tenantId,
        data.planId ?? 'free',
        data.seats ?? 1,
        data.status ?? 'created',
        data.slackTeamId ?? null,
        data.slackBotToken ?? null,
        data.slackChannel ?? null,
        data.githubInstallationId ?? null,
        data.metadata ?? {},
      ],
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<Workspace | undefined> {
    const result = await queryWithRetry<Workspace>(
      'SELECT * FROM workspaces WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  async findByTenantId(tenantId: string): Promise<Workspace[]> {
    const result = await queryWithRetry<Workspace>(
      'SELECT * FROM workspaces WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return result.rows;
  }

  async update(id: string, data: Partial<Pick<Workspace,
    'name' | 'planId' | 'seats' | 'status' | 'slackTeamId' | 'slackBotToken' | 'slackChannel' | 'githubInstallationId' | 'metadata' | 'activatedAt' | 'suspendedAt' | 'deletedAt'
  >>): Promise<Workspace | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.planId !== undefined) { sets.push(`plan_id = $${idx++}`); values.push(data.planId); }
    if (data.seats !== undefined) { sets.push(`seats = $${idx++}`); values.push(data.seats); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.slackTeamId !== undefined) { sets.push(`slack_team_id = $${idx++}`); values.push(data.slackTeamId); }
    if (data.slackBotToken !== undefined) { sets.push(`slack_bot_token = $${idx++}`); values.push(data.slackBotToken); }
    if (data.slackChannel !== undefined) { sets.push(`slack_channel = $${idx++}`); values.push(data.slackChannel); }
    if (data.githubInstallationId !== undefined) { sets.push(`github_installation_id = $${idx++}`); values.push(data.githubInstallationId); }
    if (data.metadata !== undefined) { sets.push(`metadata = $${idx++}`); values.push(data.metadata); }
    if (data.activatedAt !== undefined) { sets.push(`activated_at = $${idx++}`); values.push(data.activatedAt); }
    if (data.suspendedAt !== undefined) { sets.push(`suspended_at = $${idx++}`); values.push(data.suspendedAt); }
    if (data.deletedAt !== undefined) { sets.push(`deleted_at = $${idx++}`); values.push(data.deletedAt); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);
    const result = await queryWithRetry<Workspace>(
      `UPDATE workspaces SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0];
  }

  async list(tenantId?: string): Promise<Workspace[]> {
    if (tenantId) {
      return this.findByTenantId(tenantId);
    }
    const result = await queryWithRetry<Workspace>(
      'SELECT * FROM workspaces ORDER BY created_at DESC',
    );
    return result.rows;
  }

  async softDelete(id: string): Promise<Workspace | undefined> {
    const result = await queryWithRetry<Workspace>(
      `UPDATE workspaces SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  async deletePermanent(id: string): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM workspaces WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const workspaceRepository = new WorkspaceRepository();
