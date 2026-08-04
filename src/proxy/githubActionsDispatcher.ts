/**
 * GitHub Actions Dispatcher — triggers workflow_dispatch events on target repos.
 *
 * Uses the GitHub REST API to dispatch workflow events for CI/CD pipelines.
 * Supports any workflow that accepts workflow_dispatch with optional inputs.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   ```ts
 *   const dispatcher = new GitHubActionsDispatcher();
 *   const result = await dispatcher.dispatchWorkflow({
 *     owner: 'myorg',
 *     repo: 'myrepo',
 *     workflowId: 'ci.yml',
 *     ref: 'main',
 *     inputs: { issue_number: '42' },
 *   });
 *   ```
 *
 * ── Error Handling ───────────────────────────────────────────────────────────
 * All network errors are caught and returned as structured results. The
 * dispatcher never throws. Authentication errors (401/403) are logged and
 * surfaced in the result.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'gh-actions-dispatcher' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchWorkflowParams {
  /** Repository owner (user or org) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Workflow file name (e.g. "ci.yml") or workflow ID */
  workflowId: string;
  /** Git ref to dispatch the workflow on (branch, tag, or SHA) */
  ref: string;
  /** Optional workflow dispatch inputs (must match workflow's input schema) */
  inputs?: Record<string, string>;
}

export interface DispatchWorkflowResult {
  /** Whether the dispatch was accepted by GitHub */
  success: boolean;
  /** HTTP status code from the GitHub API */
  statusCode: number;
  /** Timestamp of the dispatch attempt */
  dispatchedAt: string;
  /** Error message if unsuccessful */
  error?: string;
  /** The workflow ID that was dispatched */
  workflowId: string;
  /** The repo identifier */
  repo: string;
  /** The owner identifier */
  owner: string;
}

export interface DispatchStatus {
  /** Whether the dispatcher is configured (has a PAT) */
  configured: boolean;
  /** Total dispatch calls made */
  totalDispatches: number;
  /** Successful dispatches */
  successfulDispatches: number;
  /** Failed dispatches */
  failedDispatches: number;
  /** Whether the proxy GitHub Actions dispatch feature is enabled */
  enabled: boolean;
  /** Timestamp of the last dispatch attempt */
  lastDispatchAt?: string;
}

// ---------------------------------------------------------------------------
// GitHubActionsDispatcher
// ---------------------------------------------------------------------------

export class GitHubActionsDispatcher {
  private totalDispatches = 0;
  private successfulDispatches = 0;
  private failedDispatches = 0;
  private lastDispatchAt: string | undefined;

  /**
   * Dispatch a workflow_dispatch event to a target repository.
   *
   * Uses the PROXY_GITHUB_PAT from config for authentication. If no PAT is
   * configured, returns an error result immediately.
   */
  async dispatchWorkflow(params: DispatchWorkflowParams): Promise<DispatchWorkflowResult> {
    const { owner, repo, workflowId, ref, inputs } = params;
    const dispatchedAt = new Date().toISOString();

    // Increment total attempts
    this.totalDispatches++;

    // Check feature flag
    if (!config.proxy.githubActionsDispatchEnabled) {
      const result: DispatchWorkflowResult = {
        success: false,
        statusCode: 0,
        dispatchedAt,
        error: 'GitHub Actions dispatch is disabled via PROXY_GITHUB_ACTIONS_DISPATCH_ENABLED',
        workflowId,
        repo,
        owner,
      };
      this.failedDispatches++;
      log.warn({ owner, repo, workflowId }, 'GitHub Actions dispatch disabled by config');
      return result;
    }

    // Check PAT
    const pat = config.proxy.pat;
    if (!pat) {
      const result: DispatchWorkflowResult = {
        success: false,
        statusCode: 0,
        dispatchedAt,
        error: 'PROXY_GITHUB_PAT is not configured — cannot dispatch workflows',
        workflowId,
        repo,
        owner,
      };
      this.failedDispatches++;
      log.warn({ owner, repo, workflowId }, 'GitHub Actions dispatch skipped — no PAT configured');
      return result;
    }

    try {
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;

      const body: Record<string, unknown> = {
        ref,
      };
      if (inputs && Object.keys(inputs).length > 0) {
        body.inputs = inputs;
      }

      log.info({ owner, repo, workflowId, ref, inputKeys: inputs ? Object.keys(inputs) : [] }, 'Dispatching GitHub Actions workflow');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${pat}`,
          'Content-Type': 'application/json',
          'User-Agent': 'syntaro-proxy/1.0',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 204) {
        this.successfulDispatches++;
        this.lastDispatchAt = dispatchedAt;
        log.info({ owner, repo, workflowId, status: response.status }, 'Workflow dispatch accepted');

        return {
          success: true,
          statusCode: response.status,
          dispatchedAt,
          workflowId,
          repo,
          owner,
        };
      }

      // Non-204 response — attempt to parse error body
      let errorMessage = `GitHub API responded with status ${response.status}`;
      try {
        const errorBody = await response.json() as { message?: string };
        if (errorBody.message) {
          errorMessage = errorBody.message;
        }
      } catch {
        // Response body may not be JSON — use default message
      }

      this.failedDispatches++;
      this.lastDispatchAt = dispatchedAt;
      log.error(
        { owner, repo, workflowId, status: response.status, error: errorMessage },
        'Workflow dispatch rejected',
      );

      return {
        success: false,
        statusCode: response.status,
        dispatchedAt,
        error: errorMessage,
        workflowId,
        repo,
        owner,
      };
    } catch (err) {
      this.failedDispatches++;
      this.lastDispatchAt = dispatchedAt;

      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err: errorMessage, owner, repo, workflowId }, 'Workflow dispatch failed due to network error');

      return {
        success: false,
        statusCode: 0,
        dispatchedAt,
        error: errorMessage,
        workflowId,
        repo,
        owner,
      };
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /**
   * Get the current dispatch status.
   */
  getStatus(): DispatchStatus {
    return {
      configured: !!config.proxy.pat,
      totalDispatches: this.totalDispatches,
      successfulDispatches: this.successfulDispatches,
      failedDispatches: this.failedDispatches,
      enabled: config.proxy.githubActionsDispatchEnabled,
      lastDispatchAt: this.lastDispatchAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const githubActionsDispatcher = new GitHubActionsDispatcher();
