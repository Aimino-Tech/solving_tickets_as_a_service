import { queryWithRetry } from '../connection.js';
import type { GitHubInstallation, NewGitHubInstallation } from '../types/githubOauth.js';

export class GitHubInstallationRepository {
  async findByUserId(userId: number): Promise<GitHubInstallation[]> {
    const result = await queryWithRetry<GitHubInstallation>(
      'SELECT * FROM github_installations WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows;
  }

  async findByInstallationId(installationId: number): Promise<GitHubInstallation | undefined> {
    const result = await queryWithRetry<GitHubInstallation>(
      'SELECT * FROM github_installations WHERE installation_id = $1',
      [installationId],
    );
    return result.rows[0];
  }

  async create(data: NewGitHubInstallation): Promise<GitHubInstallation> {
    const result = await queryWithRetry<GitHubInstallation>(
      `INSERT INTO github_installations (user_id, installation_id, account_login, account_type, repo_scope)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.userId, data.installationId, data.accountLogin, data.accountType ?? 'User', data.repoScope ?? 'selected'],
    );
    return result.rows[0];
  }

  async delete(installationId: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM github_installations WHERE installation_id = $1', [installationId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const gitHubInstallationRepository = new GitHubInstallationRepository();
