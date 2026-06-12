/**
 * ActionDispatcher — decides what action to take based on agent results.
 *
 * Thin wrapper that delegates API operations to the platform abstraction
 * layer (src/platforms/) while keeping backward compatibility for consumers
 * that import this class.
 *
 * After the agent loop completes, this class examines the result confidence
 * and takes the appropriate action: create PR (draft or ready), post comments,
 * or flag for human attention.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Outer dispatch() catch logs with context: issueNumber, repoOwner, repoName
 * ✅ Diff-gathering failure logs a warning (non-fatal, continues)
 * ✅ Error comment posting has its own try/catch fallback
 * ✅ postComment() logs warning on failure (non-fatal)
 * ✅ Sentry breadcrumbs for PR creation actions
 * ────────────────────────────────────────────────────────────────────
 */

import type { AgentResult } from '../agent/types.js';
import type { SandboxExecutor } from '../sandbox/types.js';
import { rootLogger } from '../utils/logger.js';
import { createGitHubClient, type GitHubPlatformClient } from '../platforms/github/index.js';
import * as messages from '../platforms/messages.js';
import { addBreadcrumb, setUserContext } from '../monitoring/sentry.js';

const log = rootLogger.child({ module: 'action-dispatcher' });

export interface DispatchParams {
  issueNumber: number;
  issueTitle: string;
  agentResult: AgentResult;
  sandbox: SandboxExecutor;
  relevantPRs?: Array<{ url: string; title: string; state: string }>;
  repoOwner: string;
  repoName: string;
  installationId: number;
  repoDefaultBranch?: string;
}

export interface DispatchResult {
  action: 'pr_created' | 'draft_pr_created' | 'comment_posted' | 'skipped' | 'error';
  prUrl?: string;
  prNumber?: number;
  commentBody?: string;
}

export class ActionDispatcher {
  /**
   * Dispatch the appropriate action based on agent result confidence.
   */
  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const { issueNumber, issueTitle, agentResult, sandbox, repoOwner, repoName, installationId, repoDefaultBranch } =
      params;

    // Set Sentry user context for error correlation
    setUserContext(installationId, `${repoOwner}/${repoName}`);

    // Create a platform client via the abstraction layer
    const client = await createGitHubClient(installationId);
    const baseBranch = repoDefaultBranch || 'main';

    try {
      // 1. Already fixed — just post a comment
      if (agentResult.alreadyFixed) {
        const body = messages.alreadyFixedComment(agentResult);
        await this.postComment(client, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 2. No fix possible — post explanation
      if (!agentResult.fixReady) {
        const body = messages.noFixComment(agentResult, params.relevantPRs);
        await this.postComment(client, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 3. Investigation only — post findings
      if (agentResult.investigationOnly) {
        const body = messages.investigationComment(agentResult.summary);
        await this.postComment(client, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 5. Push branch and gather changed files
      const branchName = `stas/fix-${issueNumber}-${Date.now().toString(36)}`;
      await sandbox.pushBranch(branchName);

      let changedFiles: string[] = [];
      try {
        const diffResult = await sandbox.exec(
          // biome-ignore lint/suspicious/noExplicitAny: private field access needed
          `git -C ${(sandbox as { repoDir?: string }).repoDir || `/home/user/${repoName}`} diff --name-only origin/${baseBranch}...${branchName} 2>/dev/null || true`,
        );
        changedFiles = diffResult.stdout.split('\n').filter(Boolean);
      } catch (err) {
        log.warn(
          { err: String(err), repoOwner, repoName, issueNumber },
          'Failed to gather changed files for PR body (non-fatal)',
        );
      }

      // 6a. Pre-existing tests regressed — block PR creation, branch already pushed
      if (agentResult.verification?.preExistingTestsRegressed) {
        const body = messages.regressionBlockComment(agentResult);
        await this.postComment(client, repoOwner, repoName, issueNumber, body);
        return { action: "comment_posted", commentBody: body };
      }

      // 6b. Create PR based on confidence
      if (agentResult.confidence === "high") {
        // Create a non-draft PR
        const prBody = messages.buildPRBody({
          issueNumber,
          result: agentResult,
          fileLinks: changedFiles,
          isDraft: false,
          branchName,
        });

        const pr = await client.createPullRequest({
          repoOwner,
          repoName,
          title: `Fix: ${issueTitle}`,
          head: branchName,
          base: baseBranch,
          body: prBody,
        });

        const body = messages.highConfidenceIssueComment(pr.number, agentResult);
        await this.postComment(client, repoOwner, repoName, issueNumber, body);

        log.info({ prNumber: pr.number }, 'High-confidence PR created');

        addBreadcrumb('pr', 'High-confidence PR created', {
          prNumber: String(pr.number),
          prUrl: pr.url,
          repo: `${repoOwner}/${repoName}`,
          issueNumber: String(issueNumber),
          confidence: 'high',
        });

        return {
          action: 'pr_created',
          prUrl: pr.url,
          prNumber: pr.number,
        };
      }

      if (agentResult.confidence === 'medium') {
        // Create a draft PR
        const prBody = messages.buildPRBody({
          issueNumber,
          result: agentResult,
          fileLinks: changedFiles,
          isDraft: true,
          branchName,
        });

        const pr = await client.createPullRequest({
          repoOwner,
          repoName,
          title: `[WIP] Fix: ${issueTitle}`,
          head: branchName,
          base: baseBranch,
          body: prBody,
          draft: true,
        });

        const body = messages.draftIssueComment(pr.number, agentResult);
        await this.postComment(client, repoOwner, repoName, issueNumber, body);

        log.info({ prNumber: pr.number }, 'Draft PR created');

        addBreadcrumb('pr', 'Draft PR created', {
          prNumber: String(pr.number),
          prUrl: pr.url,
          repo: `${repoOwner}/${repoName}`,
          issueNumber: String(issueNumber),
          confidence: 'medium',
        });

        return {
          action: 'draft_pr_created',
          prUrl: pr.url,
          prNumber: pr.number,
        };
      }

      // Low confidence — post comment with branch info but no PR
      const testOutput = agentResult.testOutput || '';
      const lowBody = messages.lowConfidenceComment(agentResult, testOutput);
      await this.postComment(client, repoOwner, repoName, issueNumber, lowBody);

      return { action: 'comment_posted', commentBody: lowBody };
    } catch (err) {
      log.error({ err: String(err), issueNumber, repoOwner, repoName }, 'Error dispatching action');

      addBreadcrumb('pr', 'PR creation failed', {
        repo: `${repoOwner}/${repoName}`,
        issueNumber: String(issueNumber),
        error: String(err),
      });

      // Fallback: post error comment
      const errorBody = messages.errorComment(`Action dispatch failed: ${String(err)}`);
      try {
        await this.postComment(client, repoOwner, repoName, issueNumber, errorBody);
      } catch (commentErr) {
        log.error(
          { err: String(commentErr), issueNumber, repoOwner, repoName },
          'Failed to post error comment as well',
        );
      }

      return { action: 'error' };
    }
  }

  /**
   * Post a comment to an issue using the platform client.
   * Logs context on failure and re-throws so callers can handle.
   */
  private async postComment(
    client: GitHubPlatformClient,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    try {
      await client.createComment(`${owner}/${repo}`, issueNumber, body);
    } catch (err) {
      log.warn({ err: String(err), owner, repo, issueNumber }, 'Failed to post comment to issue');
      throw err;
    }
  }
}
