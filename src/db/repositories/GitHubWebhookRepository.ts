import { queryWithRetry } from '../connection.js';
import type { GitHubWebhookConfig, NewGitHubWebhookConfig } from '../types/githubOauth.js';

export class GitHubWebhookRepository {
  async findByOwnerAndRepo(owner: string, repo: string): Promise<GitHubWebhookConfig | undefined> {
    const result = await queryWithRetry<GitHubWebhookConfig>(
      'SELECT * FROM github_webhook_configs WHERE owner = $1 AND repo = $2',
      [owner, repo],
    );
    return result.rows[0];
  }

  async findByUserId(userId: number): Promise<GitHubWebhookConfig[]> {
    const result = await queryWithRetry<GitHubWebhookConfig>(
      'SELECT * FROM github_webhook_configs WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows;
  }

  async create(data: NewGitHubWebhookConfig): Promise<GitHubWebhookConfig> {
    const result = await queryWithRetry<GitHubWebhookConfig>(
      `INSERT INTO github_webhook_configs (user_id, installation_id, owner, repo, webhook_id, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.userId, data.installationId, data.owner, data.repo, data.webhookId, data.webhookUrl],
    );
    return result.rows[0];
  }

  async deactivate(id: number): Promise<boolean> {
    const result = await queryWithRetry('UPDATE github_webhook_configs SET active = false, updated_at = NOW() WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const gitHubWebhookRepository = new GitHubWebhookRepository();
