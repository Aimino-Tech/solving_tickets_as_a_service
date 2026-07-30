import { queryWithRetry } from '../connection.js';
import type { GitHubInstallation, NewGitHubInstallation } from '../types/githubOAuth.js';

export class GitHubInstallationRepository {
  async findById(id: number): Promise<GitHubInstallation | undefined> {
    const result = await queryWithRetry<GitHubInstallation>(
      `SELECT id, user_id, installation_id, account_login, account_type,
              repo_scope, avatar_url, repos_json, created_at, updated_at
       FROM github_installations WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  async findByInstallationId(installationId: number): Promise<GitHubInstallation | undefined> {
    const result = await queryWithRetry<GitHubInstallation>(
      `SELECT id, user_id, installation_id, account_login, account_type,
              repo_scope, avatar_url, repos_json, created_at, updated_at
       FROM github_installations WHERE installation_id = $1`,
      [installationId],
    );
    return result.rows[0];
  }

  async findByUserId(userId: number): Promise<GitHubInstallation[]> {
    const result = await queryWithRetry<GitHubInstallation>(
      `SELECT id, user_id, installation_id, account_login, account_type,
              repo_scope, avatar_url, repos_json, created_at, updated_at
       FROM github_installations WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async create(data: NewGitHubInstallation): Promise<GitHubInstallation> {
    const reposJson = data.reposJson ? JSON.stringify(data.reposJson) : '[]';
    const result = await queryWithRetry<GitHubInstallation>(
      `INSERT INTO github_installations (user_id, installation_id, account_login, account_type, repo_scope, avatar_url, repos_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (installation_id)
       DO UPDATE SET account_login = $3, account_type = $4, repo_scope = $5,
                     avatar_url = COALESCE($6, github_installations.avatar_url),
                     repos_json = COALESCE($7::jsonb, github_installations.repos_json),
                     updated_at = NOW()
       RETURNING id, user_id, installation_id, account_login, account_type,
                 repo_scope, avatar_url, repos_json, created_at, updated_at`,
      [data.userId, data.installationId, data.accountLogin, data.accountType ?? 'User',
       data.repoScope ?? 'selected', data.avatarUrl ?? null, reposJson],
    );
    return result.rows[0];
  }

  async deleteByInstallationId(installationId: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM github_installations WHERE installation_id = $1', [installationId]);
    return (result.rowCount ?? 0) > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM github_installations WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const gitHubInstallationRepository = new GitHubInstallationRepository();
