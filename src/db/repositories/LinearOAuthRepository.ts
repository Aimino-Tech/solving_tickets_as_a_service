import { queryWithRetry } from '../connection.js';
import type { LinearOAuthToken, NewLinearOAuthToken } from '../types/linearOAuth.js';

export class LinearOAuthRepository {
  async findByUserId(userId: string): Promise<LinearOAuthToken | undefined> {
    const result = await queryWithRetry<LinearOAuthToken>(
      'SELECT * FROM linear_oauth_tokens WHERE user_id = $1',
      [userId],
    );
    return result.rows[0];
  }

  async findByLinearUserId(linearUserId: string): Promise<LinearOAuthToken | undefined> {
    const result = await queryWithRetry<LinearOAuthToken>(
      'SELECT * FROM linear_oauth_tokens WHERE linear_user_id = $1',
      [linearUserId],
    );
    return result.rows[0];
  }

  async upsert(data: NewLinearOAuthToken): Promise<LinearOAuthToken> {
    const result = await queryWithRetry<LinearOAuthToken>(
      `INSERT INTO linear_oauth_tokens
       (user_id, access_token_encrypted, refresh_token_encrypted, linear_user_id, linear_user_name, linear_user_email, token_expires_at, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id)
       DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         linear_user_id = EXCLUDED.linear_user_id,
         linear_user_name = EXCLUDED.linear_user_name,
         linear_user_email = EXCLUDED.linear_user_email,
         token_expires_at = EXCLUDED.token_expires_at,
         scope = EXCLUDED.scope,
         updated_at = NOW()
       RETURNING *`,
      [
        data.userId,
        data.accessTokenEncrypted,
        data.refreshTokenEncrypted ?? null,
        data.linearUserId ?? null,
        data.linearUserName ?? null,
        data.linearUserEmail ?? null,
        data.tokenExpiresAt ?? null,
        data.scope ?? null,
      ],
    );
    return result.rows[0];
  }

  async delete(userId: string): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM linear_oauth_tokens WHERE user_id = $1', [userId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const linearOAuthRepository = new LinearOAuthRepository();
