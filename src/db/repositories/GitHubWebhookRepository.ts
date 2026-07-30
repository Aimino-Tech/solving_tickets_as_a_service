import { queryWithRetry } from '../connection.js';
import type { GitHubWebhookConfig as GitHubWebhook, NewGitHubWebhookConfig as NewGitHubWebhook } from '../types/githubOAuth.js';

export class GitHubWebhookRepository {
  async findByInstallationId(installationId: number): Promise<GitHubWebhook[]> {
    const result = await queryWithRetry<GitHubWebhook>(
      `SELECT id, user_id, installation_id, repo_owner, repo_name, webhook_id, webhook_url, active, created_at, updated_at
       FROM github_webhook_configs WHERE installation_id = $1 AND active = true`,
      [installationId],
    );
    return result.rows;
  }

  async findByUserId(userId: number): Promise<GitHubWebhook[]> {
    const result = await queryWithRetry<GitHubWebhook>(
      `SELECT id, user_id, installation_id, repo_owner, repo_name, webhook_id, webhook_url, active, created_at, updated_at
       FROM github_webhook_configs WHERE user_id = $1 AND active = true`,
      [userId],
    );
    return result.rows;
  }

  async findByOwnerAndRepo(owner: string, repo: string): Promise<GitHubWebhook | undefined> {
    const result = await queryWithRetry<GitHubWebhook>(
      `SELECT id, user_id, installation_id, repo_owner, repo_name, webhook_id, webhook_url, active, created_at, updated_at
       FROM github_webhook_configs WHERE repo_owner = $1 AND repo_name = $2 AND active = true`,
      [owner, repo],
    );
    return result.rows[0];
  }

  async create(data: NewGitHubWebhook): Promise<GitHubWebhook> {
    const result = await queryWithRetry<GitHubWebhook>(
      `INSERT INTO github_webhook_configs (user_id, installation_id, repo_owner, repo_name, webhook_id, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, installation_id, repo_owner, repo_name, webhook_id, webhook_url, active, created_at, updated_at`,
      [data.userId, data.installationId, data.repoOwner, data.repoName, data.webhookId, data.webhookUrl],
    );
    return result.rows[0];
  }

  async deactivate(id: number): Promise<boolean> {
    const result = await queryWithRetry(
      'UPDATE github_webhook_configs SET active = false, updated_at = NOW() WHERE id = $1',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM github_webhook_configs WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteByInstallationId(installationId: number): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM github_webhook_configs WHERE installation_id = $1', [installationId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const gitHubWebhookRepository = new GitHubWebhookRepository();
