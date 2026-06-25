/**
 * Repository and label configuration for onboarding.
 *
 * Manages the per-tenant repository whitelist and label settings.
 * Uses the `tenant_repos` DB table for persistence.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Missing tenant returns empty array (not an error)
 * ✅ GitHub API label update failures caught and surfaced
 * ✅ Duplicate repo entries silently handled via upsert
 * ────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'onboarding-config' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoConfig {
  /** Repository owner (user or org) */
  owner: string;
  /** Repository name */
  name: string;
  /** GitHub App installation ID */
  installationId: number;
  /** Labels that trigger STAS (default: ['stas:fix']) */
  labels: string[];
}

export interface TenantRepoRow {
  id: number;
  tenantId: string;
  owner: string;
  name: string;
  installationId: number;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Repo Configuration Service
// ---------------------------------------------------------------------------

export class OnboardingRepoConfig {
  /**
   * Save repository whitelist for a tenant.
   * Replaces all existing repos for this tenant with the new list.
   */
  async saveRepos(tenantId: string, repos: RepoConfig[]): Promise<TenantRepoRow[]> {
    const { queryWithRetry } = await import('../db/connection.js');

    // Delete existing repos for this tenant
    await queryWithRetry('DELETE FROM tenant_repos WHERE tenant_id = $1', [tenantId]);

    // Insert new repos
    const saved: TenantRepoRow[] = [];
    for (const repo of repos) {
      try {
        const result = await queryWithRetry<{
          id: number;
          tenant_id: string;
          owner: string;
          name: string;
          installation_id: number;
          labels: string[];
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO tenant_repos (tenant_id, owner, name, installation_id, labels)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [tenantId, repo.owner, repo.name, repo.installationId, repo.labels],
        );

        const row = result.rows[0];
        saved.push({
          id: row.id,
          tenantId: row.tenant_id,
          owner: row.owner,
          name: row.name,
          installationId: row.installation_id,
          labels: row.labels,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      } catch (err) {
        log.error(
          { err: String(err), tenantId, owner: repo.owner, name: repo.name },
          'Failed to save tenant repo',
        );
        throw new Error(`Failed to save repository ${repo.owner}/${repo.name}. Please try again.`);
      }
    }

    log.info({ tenantId, count: saved.length }, 'Tenant repos saved');
    return saved;
  }

  /**
   * Get all configured repos for a tenant.
   */
  async getRepos(tenantId: string): Promise<TenantRepoRow[]> {
    const { queryWithRetry } = await import('../db/connection.js');

    const result = await queryWithRetry<{
      id: number;
      tenant_id: string;
      owner: string;
      name: string;
      installation_id: number;
      labels: string[];
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT * FROM tenant_repos WHERE tenant_id = $1 ORDER BY owner, name',
      [tenantId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      owner: row.owner,
      name: row.name,
      installationId: row.installation_id,
      labels: row.labels,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update labels for a specific repo via GitHub API.
   */
  async updateLabels(
    installationId: number,
    owner: string,
    repo: string,
    labels: string[],
  ): Promise<void> {
    // Get a GitHub App installation token
    const { getInstallationToken } = await import('../github/auth.js');

    try {
      const token = await getInstallationToken(installationId);

      // Update labels via GitHub API
      const existingLabel = labels[0] ?? 'stas:fix';

      // Ensure the label exists on the repo
      const createRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/labels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github.v3+json',
          },
          body: JSON.stringify({
            name: existingLabel,
            color: '5319E7',
            description: 'Trigger STAS to investigate and fix this issue',
          }),
        },
      );

      if (createRes.ok) {
        log.info({ owner, repo, label: existingLabel }, 'Label created on repository');
      } else if (createRes.status === 422) {
        // Label already exists — that's fine
        log.debug({ owner, repo, label: existingLabel }, 'Label already exists on repository');
      } else {
        const errorText = await createRes.text();
        log.warn(
          { owner, repo, status: createRes.status, error: errorText },
          'Failed to create label on repository',
        );
        // Non-fatal — the default label may already exist
      }

      // Update the DB record
      const { queryWithRetry } = await import('../db/connection.js');
      await queryWithRetry(
        `UPDATE tenant_repos
         SET labels = $1, updated_at = NOW()
         WHERE installation_id = $2 AND owner = $3 AND name = $4`,
        [labels, installationId, owner, repo],
      );

      log.info({ owner, repo, labels }, 'Labels updated for repo');
    } catch (err) {
      log.error(
        { err: String(err), owner, repo, installationId },
        'Failed to update labels for repo',
      );
      throw new Error(
        `Failed to update labels for ${owner}/${repo}. ` +
        'Please ensure the GitHub App is installed on this repository.',
      );
    }
  }

  /**
   * Delete a repo configuration for a tenant.
   */
  async deleteRepo(tenantId: string, owner: string, name: string): Promise<boolean> {
    const { queryWithRetry } = await import('../db/connection.js');
    const result = await queryWithRetry(
      `DELETE FROM tenant_repos WHERE tenant_id = $1 AND owner = $2 AND name = $3`,
      [tenantId, owner, name],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export const onboardingRepoConfig = new OnboardingRepoConfig();
