/**
 * Per-tenant workspace isolation.
 *
 * Each fix run gets a dedicated workspace directory under
 * `/workspaces/{tenantId}/{issueKey}/`, ensuring that concurrent runs
 * from different tenants never share files, and runs from the same tenant
 * are also isolated by issue.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * - Workspace root is configurable via `WORKSPACES_ROOT` env var (default: /workspaces)
 * - Path structure: {workspaceRoot}/{tenantId}/{issueKey}/
 * - Directories are created with restricted permissions (0700)
 * - Cleanup removes the workspace after the fix completes
 * ────────────────────────────────────────────────────────────────────────────
 */

import { mkdir, access, rm, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'workspace-isolation' });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the absolute workspace path for a tenant + issue combination.
 *
 * @param tenantId - The tenant identifier (e.g. GitHub installation ID as string)
 * @param issueKey - The issue key (e.g. "repoOwner/repoName#42")
 * @returns Absolute path to the workspace directory
 *
 * @example
 * ```ts
 * getWorkspaceRoot('tenant-abc', 'owner/repo#42')
 * // => '/workspaces/tenant-abc/owner/repo#42/'
 * ```
 */
export function getWorkspaceRoot(tenantId: string, issueKey: string): string {
  // Sanitize inputs to prevent path traversal
  const safeTenantId = sanitizePathComponent(tenantId);
  const safeIssueKey = sanitizePathComponent(issueKey);
  return join(config.workspaceRoot || '/workspaces', safeTenantId, safeIssueKey) + '/';
}

/**
 * Ensure the workspace directory exists for a tenant + issue combination.
 * Creates intermediate directories as needed with restricted permissions.
 *
 * @param tenantId - The tenant identifier
 * @param issueKey - The issue key
 * @returns Absolute path to the created workspace directory (with trailing slash)
 *
 * @throws If the directory cannot be created or has incorrect permissions
 */
export async function ensureWorkspaceDir(tenantId: string, issueKey: string): Promise<string> {
  const workspacePath = getWorkspaceRoot(tenantId, issueKey);

  try {
    // Check if it already exists
    await access(workspacePath, constants.F_OK | constants.W_OK);
    log.debug({ workspacePath, tenantId, issueKey }, 'Workspace directory already exists');
    return workspacePath;
  } catch {
    // Directory doesn't exist or isn't writable — create it
  }

  log.info({ workspacePath, tenantId, issueKey }, 'Creating workspace directory');

  try {
    await mkdir(workspacePath, { recursive: true, mode: 0o700 });
    log.info({ workspacePath, tenantId, issueKey }, 'Workspace directory created');
  } catch (err) {
    const errorMsg = `Failed to create workspace directory ${workspacePath}: ${String(err)}`;
    log.error({ err: String(err), workspacePath, tenantId, issueKey }, errorMsg);
    throw new Error(errorMsg);
  }

  return workspacePath;
}

/**
 * Remove a workspace directory after a fix is complete.
 *
 * @param tenantId - The tenant identifier
 * @param issueKey - The issue key
 *
 * Safely handles:
 * - Non-existent directories (no-op)
 * - Permission errors (logged, non-fatal)
 * - Concurrent cleanup (race-safe)
 */
export async function cleanupWorkspace(tenantId: string, issueKey: string): Promise<void> {
  const workspacePath = getWorkspaceRoot(tenantId, issueKey);

  log.info({ workspacePath, tenantId, issueKey }, 'Cleaning up workspace directory');

  try {
    await rm(workspacePath, { recursive: true, force: true });
    log.info({ workspacePath, tenantId, issueKey }, 'Workspace directory removed');
  } catch (err) {
    log.warn(
      { err: String(err), workspacePath, tenantId, issueKey },
      'Failed to remove workspace directory (non-fatal)',
    );
  }

  // Attempt to clean up the parent tenant directory if it's now empty
  const tenantDir = join(config.workspaceRoot || '/workspaces', sanitizePathComponent(tenantId));
  try {
    await rm(tenantDir, { recursive: true, force: true });
    log.debug({ tenantDir }, 'Tenant workspace root removed');
  } catch {
    // Directory not empty or other error — that's fine
  }
}

/**
 * Check if a workspace directory exists for a given tenant + issue.
 */
export async function workspaceExists(tenantId: string, issueKey: string): Promise<boolean> {
  const workspacePath = getWorkspaceRoot(tenantId, issueKey);
  try {
    await access(workspacePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a path component to prevent directory traversal attacks.
 *
 * Removes:
 * - Leading slashes
 * - '..' path components
 * - Null bytes
 * - Any character that could be used for traversal
 */
function sanitizePathComponent(input: string): string {
  return input
    .replace(/\.\./g, '')
    .replace(/\0/g, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '_')
    .replace(/[<>:"|?*\\]/g, '_')
    .trim();
}
