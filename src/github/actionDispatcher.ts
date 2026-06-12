/**
 * @deprecated Use `@stas/github-client` instead.
 * This file is a thin wrapper around the standalone package for backward compatibility.
 * Extended with platform awareness for Bitbucket/GitLab.
 */
import { rootLogger } from '../utils/logger.js';
import { getOctokit } from './auth.js';
import { addBreadcrumb } from '../monitoring/sentry.js';
import { dispatchAction } from '@stas/github-client';
import type { SandboxExecutor } from '../sandbox/types.js';
import type { PlatformClient, CreatePullRequestParams } from '../webhooks/base.js';
import { getPlatformClient } from '../platforms/registry.js';

const log = rootLogger.child({ module: 'action-dispatcher' });

export interface DispatchParams {
  issueNumber: number;
  issueTitle: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentResult: any;
  sandbox: SandboxExecutor;
  relevantPRs?: Array<{ url: string; title: string; state: string }>;
  repoOwner: string;
  repoName: string;
  installationId: number;
  repoDefaultBranch?: string;
  platform?: string;
}

export interface DispatchResult {
  action: 'pr_created' | 'draft_pr_created' | 'comment_posted' | 'skipped' | 'error';
  prUrl?: string;
  prNumber?: number;
  commentBody?: string;
}

export class ActionDispatcher {
  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const { issueNumber, issueTitle, agentResult, sandbox, repoOwner, repoName, installationId, repoDefaultBranch, platform } = params;

    if (platform && platform !== 'github') {
      return this.dispatchToPlatform(platform, params);
    }

    const octokit = await getOctokit(installationId);

    return dispatchAction(
      {
        octokit,
        postComment: async (num, body) => { await octokit.issues.createComment({ owner: repoOwner, repo: repoName, issue_number: num, body }); },
        pushBranch: (branchName) => sandbox.pushBranch(branchName),
        getChangedFiles: async (branchName, baseBranch) => {
          try {
            const diffResult = await sandbox.exec(
              `git -C ${(sandbox as { repoDir?: string }).repoDir || `/home/user/${repoName}`} diff --name-only origin/${baseBranch}...${branchName} 2>/dev/null || true`,
            );
            return diffResult.stdout.split('\n').filter(Boolean);
          } catch {
            log.warn({ repoOwner, repoName, issueNumber }, 'Failed to gather changed files (non-fatal)');
            return [];
          }
        },
        addBreadcrumb: (category, message, data) => addBreadcrumb(category, message, data),
        log: {
          info: (msg, text) => log.info(msg, text),
          warn: (msg, text) => log.warn(msg, text),
          error: (msg, text) => log.error(msg, text),
        },
      },
      { issueNumber, issueTitle, agentResult, repoOwner, repoName, baseBranch: repoDefaultBranch },
    );
  }

  private async dispatchToPlatform(
    platform: string,
    params: DispatchParams,
  ): Promise<DispatchResult> {
    const { issueNumber, issueTitle, agentResult, sandbox, repoOwner, repoName, repoDefaultBranch } = params;
    const client = getPlatformClient(platform as Parameters<typeof getPlatformClient>[0]);
    if (!client) {
      log.error({ platform }, 'No platform client registered for platform');
      return { action: 'error' };
    }

    try {
      if (!agentResult.fixReady) {
        return { action: 'comment_posted' };
      }

      const bb = repoDefaultBranch || 'main';
      const branchName = `stas/fix-${issueNumber}-${Date.now().toString(36)}`;
      await sandbox.pushBranch(branchName);

      const prParams: CreatePullRequestParams = {
        repoOwner,
        repoName,
        title: `Fix: ${issueTitle}`,
        head: branchName,
        base: bb,
        body: agentResult.summary || '',
        draft: agentResult.confidence !== 'high',
      };

      const pr = await client.createPullRequest(prParams);
      log.info({ prNumber: pr.number, platform }, 'Platform PR created');

      await client.createComment(repoOwner, repoName, issueNumber, `### ✅ STAS Fix Complete\n\nA fix has been created and is ready for review.\n\n**PR**: ${pr.url}`);

      return { action: 'pr_created', prUrl: pr.url, prNumber: pr.number };
    } catch (err) {
      log.error({ err: String(err), platform }, 'Platform dispatch failed');
      return { action: 'error' };
    }
  }
}
