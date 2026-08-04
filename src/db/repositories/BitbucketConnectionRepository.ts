import { queryWithRetry } from '../connection.js';
import type { BitbucketAuthMethod, BitbucketConnection, NewBitbucketConnection } from '../types/bitbucket.js';

/** Map pg snake_case row to camelCase BitbucketConnection. */
function mapRow(row: Record<string, unknown>): BitbucketConnection {
  const authMethod = String(row.auth_method ?? row.authMethod ?? 'api_token') as BitbucketAuthMethod;
  return {
    userId: String(row.user_id ?? row.userId),
    username: String(row.username),
    appPasswordEncrypted: String(row.app_password_encrypted ?? row.appPasswordEncrypted),
    workspace: String(row.workspace),
    authMethod: authMethod === 'oauth' ? 'oauth' : 'api_token',
    refreshTokenEncrypted: (row.refresh_token_encrypted ?? row.refreshTokenEncrypted ?? null) as string | null,
    bitbucketUuid: (row.bitbucket_uuid ?? row.bitbucketUuid ?? null) as string | null,
    scope: (row.scope ?? null) as string | null,
    tokenExpiresAt: (row.token_expires_at ?? row.tokenExpiresAt ?? null) as Date | null,
    createdAt: (row.created_at ?? row.createdAt) as Date,
    updatedAt: (row.updated_at ?? row.updatedAt) as Date,
  };
}

class BitbucketConnectionRepository {
  async findByUserId(userId: string): Promise<BitbucketConnection | undefined> {
    const result = await queryWithRetry('SELECT * FROM bitbucket_connections WHERE user_id = $1', [userId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  async findByWorkspace(workspace: string): Promise<BitbucketConnection | undefined> {
    const result = await queryWithRetry('SELECT * FROM bitbucket_connections WHERE workspace = $1', [workspace]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  async upsert(data: NewBitbucketConnection): Promise<BitbucketConnection> {
    const result = await queryWithRetry(
      `INSERT INTO bitbucket_connections
         (user_id, username, app_password_encrypted, workspace,
          auth_method, refresh_token_encrypted, bitbucket_uuid, scope, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         app_password_encrypted = EXCLUDED.app_password_encrypted,
         workspace = EXCLUDED.workspace,
         auth_method = EXCLUDED.auth_method,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         bitbucket_uuid = EXCLUDED.bitbucket_uuid,
         scope = EXCLUDED.scope,
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at = NOW()
       RETURNING *`,
      [
        data.userId,
        data.username,
        data.appPasswordEncrypted,
        data.workspace,
        data.authMethod ?? 'api_token',
        data.refreshTokenEncrypted ?? null,
        data.bitbucketUuid ?? null,
        data.scope ?? null,
        data.tokenExpiresAt ?? null,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  async delete(userId: string): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM bitbucket_connections WHERE user_id = $1', [userId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const bitbucketConnectionRepository = new BitbucketConnectionRepository();
export { BitbucketConnectionRepository };
