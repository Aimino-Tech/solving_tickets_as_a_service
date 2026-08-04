import { queryWithRetry } from '../connection.js';
import type { NewSlackOAuthToken, SlackOAuthToken } from '../types/slackOAuth.js';

class SlackOAuthRepository {
  async findByUserId(userId: string): Promise<SlackOAuthToken | undefined> {
    const result = await queryWithRetry<SlackOAuthToken>('SELECT * FROM slack_oauth_tokens WHERE user_id = $1', [
      userId,
    ]);
    return result.rows[0];
  }

  async upsert(data: NewSlackOAuthToken): Promise<SlackOAuthToken> {
    const result = await queryWithRetry<SlackOAuthToken>(
      `INSERT INTO slack_oauth_tokens
         (user_id, bot_token_encrypted, app_token_encrypted, slack_team_id, slack_team_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         bot_token_encrypted = EXCLUDED.bot_token_encrypted,
         app_token_encrypted = EXCLUDED.app_token_encrypted,
         slack_team_id = EXCLUDED.slack_team_id,
         slack_team_name = EXCLUDED.slack_team_name,
         updated_at = NOW()
       RETURNING *`,
      [
        data.userId,
        data.botTokenEncrypted,
        data.appTokenEncrypted ?? null,
        data.slackTeamId ?? null,
        data.slackTeamName ?? null,
      ],
    );
    return result.rows[0];
  }

  async delete(userId: string): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM slack_oauth_tokens WHERE user_id = $1', [userId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const slackOAuthRepository = new SlackOAuthRepository();
