import { queryWithRetry } from '../connection.js';
import type { GitHubOAuthToken, NewGitHubOAuthToken } from '../types/githubOAuth.js';

export class GitHubOAuthRepository {
  async findByUserId(userId: string): Promise<GitHubOAuthToken | undefined> {
    const result = await queryWithRetry<GitHubOAuthToken>(
      'SELECT * FROM github_oauth_tokens WHERE user_id = $1',
      [userId],
    );
    return result.rows[0];
  }

  async findByGithubUserId(githubUserId: number): Promise<GitHubOAuthToken | undefined> {
    const result = await queryWithRetry<GitHubOAuthToken>(
      'SELECT * FROM github_oauth_tokens WHERE github_user_id = $1',
      [githubUserId],
    );
    return result.rows[0];
  }

  async upsert(data: NewGitHubOAuthToken): Promise<GitHubOAuthToken> {
    const result = await queryWithRetry<GitHubOAuthToken>(
      `INSERT INTO github_oauth_tokens
       (user_id, access_token_encrypted, refresh_token_encrypted, github_login, github_user_id, token_expires_at, refresh_token_expires_at, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id)
       DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         github_login = EXCLUDED.github_login,
         github_user_id = EXCLUDED.github_user_id,
         token_expires_at = EXCLUDED.token_expires_at,
         refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
         scope = EXCLUDED.scope,
         updated_at = NOW()
       RETURNING *`,
      [
        data.userId,
        data.accessTokenEncrypted,
        data.refreshTokenEncrypted ?? null,
        data.githubLogin,
        data.githubUserId,
        data.tokenExpiresAt ?? null,
        data.refreshTokenExpiresAt ?? null,
        data.scope ?? null,
      ],
    );
    return result.rows[0];
  }

  async delete(userId: string): Promise<boolean> {
    const result = await queryWithRetry(
      'DELETE FROM github_oauth_tokens WHERE user_id = $1',
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export const gitHubOAuthRepository = new GitHubOAuthRepository();
