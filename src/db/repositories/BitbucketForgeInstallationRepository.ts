import { queryWithRetry } from '../connection.js';
import type { BitbucketForgeInstallation, NewBitbucketForgeInstallation } from '../types/bitbucketForge.js';

/** Map pg snake_case row to camelCase BitbucketForgeInstallation. */
function mapRow(row: Record<string, unknown>): BitbucketForgeInstallation {
  return {
    installationId: String(row.installation_id ?? row.installationId),
    appId: String(row.app_id ?? row.appId),
    workspaceUuid: (row.workspace_uuid ?? row.workspaceUuid ?? null) as string | null,
    workspaceSlug: (row.workspace_slug ?? row.workspaceSlug ?? null) as string | null,
    apiBaseUrl: (row.api_base_url ?? row.apiBaseUrl ?? null) as string | null,
    systemTokenEncrypted: (row.system_token_encrypted ?? row.systemTokenEncrypted ?? null) as string | null,
    tokenExpiresAt: (row.token_expires_at ?? row.tokenExpiresAt ?? null) as Date | null,
    createdAt: (row.created_at ?? row.createdAt) as Date,
    updatedAt: (row.updated_at ?? row.updatedAt) as Date,
  };
}

class BitbucketForgeInstallationRepository {
  async findByInstallationId(installationId: string): Promise<BitbucketForgeInstallation | undefined> {
    const result = await queryWithRetry('SELECT * FROM bitbucket_forge_installations WHERE installation_id = $1', [
      installationId,
    ]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** Resolve by workspace slug OR UUID (the worker resolves by slug; events arrive with UUID). */
  async findByWorkspace(workspace: string): Promise<BitbucketForgeInstallation | undefined> {
    const result = await queryWithRetry(
      `SELECT * FROM bitbucket_forge_installations
       WHERE workspace_slug = $1 OR workspace_uuid = $1
       LIMIT 1`,
      [workspace],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  async upsert(data: NewBitbucketForgeInstallation): Promise<BitbucketForgeInstallation> {
    const result = await queryWithRetry(
      `INSERT INTO bitbucket_forge_installations
         (installation_id, app_id, workspace_uuid, workspace_slug,
          api_base_url, system_token_encrypted, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (installation_id) DO UPDATE SET
         app_id = EXCLUDED.app_id,
         workspace_uuid = COALESCE(EXCLUDED.workspace_uuid, bitbucket_forge_installations.workspace_uuid),
         workspace_slug = COALESCE(EXCLUDED.workspace_slug, bitbucket_forge_installations.workspace_slug),
         api_base_url = COALESCE(EXCLUDED.api_base_url, bitbucket_forge_installations.api_base_url),
         system_token_encrypted = COALESCE(EXCLUDED.system_token_encrypted, bitbucket_forge_installations.system_token_encrypted),
         token_expires_at = COALESCE(EXCLUDED.token_expires_at, bitbucket_forge_installations.token_expires_at),
         updated_at = NOW()
       RETURNING *`,
      [
        data.installationId,
        data.appId,
        data.workspaceUuid ?? null,
        data.workspaceSlug ?? null,
        data.apiBaseUrl ?? null,
        data.systemTokenEncrypted ?? null,
        data.tokenExpiresAt ?? null,
      ],
    );
    return mapRow(result.rows[0] as Record<string, unknown>);
  }

  /** Rotate the cached app-system token without touching workspace metadata. */
  async rotateToken(
    installationId: string,
    systemTokenEncrypted: string,
    tokenExpiresAt: Date | null,
  ): Promise<boolean> {
    const result = await queryWithRetry(
      `UPDATE bitbucket_forge_installations
       SET system_token_encrypted = $2, token_expires_at = $3, updated_at = NOW()
       WHERE installation_id = $1`,
      [installationId, systemTokenEncrypted, tokenExpiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Attach workspace identity once the first product event carries workspace.uuid. */
  async setWorkspace(installationId: string, workspaceUuid: string, workspaceSlug: string | null): Promise<boolean> {
    const result = await queryWithRetry(
      `UPDATE bitbucket_forge_installations
       SET workspace_uuid = $2, workspace_slug = COALESCE($3, workspace_slug), updated_at = NOW()
       WHERE installation_id = $1`,
      [installationId, workspaceUuid, workspaceSlug],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async delete(installationId: string): Promise<boolean> {
    const result = await queryWithRetry('DELETE FROM bitbucket_forge_installations WHERE installation_id = $1', [
      installationId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const bitbucketForgeInstallationRepository = new BitbucketForgeInstallationRepository();
export { BitbucketForgeInstallationRepository };
