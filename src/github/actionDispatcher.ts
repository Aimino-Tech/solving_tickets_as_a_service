/**
 * ActionDispatcher — decides what action to take based on agent results.
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
 * ────────────────────────────────────────────────────────────────────
 */

import type { AgentResult } from '../agent/types.js';
import type { SandboxExecutor } from '../sandbox/executor.js';
import { rootLogger } from '../utils/logger.js';
import * as Sentry from '@sentry/node';
import { getOctokit } from './auth.js';
import * as messages from './messages.js';

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

    const octokit = await getOctokit(installationId);
    const baseBranch = repoDefaultBranch || 'main';

    try {
      // 1. Already fixed — just post a comment
      if (agentResult.alreadyFixed) {
        const body = messages.alreadyFixedComment(agentResult);
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 2. No fix possible — post explanation
      if (!agentResult.fixReady) {
        const body = messages.noFixComment(agentResult, params.relevantPRs);
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 3. Investigation only — post findings
      if (agentResult.investigationOnly) {
        const body = messages.investigationComment(agentResult.summary);
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 5. Push branch and gather changed files
      const branchName = `stas/fix-${issueNumber}-${Date.now().toString(36)}`;
      await sandbox.pushBranch(branchName);

      let changedFiles: string[] = [];
      try {
        const diffResult = await sandbox.exec(
          // biome-ignore lint/suspicious/noExplicitAny: private field access needed
          `git -C ${(sandbox as any).repoDir || `/home/user/${repoName}`} diff --name-only origin/${baseBranch}...${branchName} 2>/dev/null || true`,
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
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
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

        const pr = await octokit.pulls.create({
          owner: repoOwner,
          repo: repoName,
          title: `Fix: ${issueTitle}`,
          head: branchName,
          base: baseBranch,
          body: prBody,
        });

        const body = messages.highConfidenceIssueComment(pr.data.number, agentResult);
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);

        log.info({ prNumber: pr.data.number }, 'High-confidence PR created');
        Sentry.addBreadcrumb({
          category: 'pr',
          message: `PR created (high confidence): #${pr.data.number}`,
          level: 'info',
          data: {
            prNumber: pr.data.number,
            prUrl: pr.data.html_url,
            confidence: 'high',
            repoOwner,
            repoName,
            issueNumber,
          },
        });
        Sentry.setTag('pr.number', pr.data.number);
        Sentry.setTag('pr.confidence', 'high');
        return {
          action: 'pr_created',
          prUrl: pr.data.html_url,
          prNumber: pr.data.number,
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

        const pr = await octokit.pulls.create({
          owner: repoOwner,
          repo: repoName,
          title: `[WIP] Fix: ${issueTitle}`,
          head: branchName,
          base: baseBranch,
          body: prBody,
          draft: true,
        });

        const body = messages.draftIssueComment(pr.data.number, agentResult);
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);

        log.info({ prNumber: pr.data.number }, 'Draft PR created');
        Sentry.addBreadcrumb({
          category: 'pr',
          message: `Draft PR created (medium confidence): #${pr.data.number}`,
          level: 'info',
          data: {
            prNumber: pr.data.number,
            prUrl: pr.data.html_url,
            confidence: 'medium',
            repoOwner,
            repoName,
            issueNumber,
          },
        });
        Sentry.setTag('pr.number', pr.data.number);
        Sentry.setTag('pr.confidence', 'medium');
        return {
          action: 'draft_pr_created',
          prUrl: pr.data.html_url,
          prNumber: pr.data.number,
        };
      }

      // Low confidence — post comment with branch info but no PR
      const testOutput = agentResult.testOutput || '';
      const lowBody = messages.lowConfidenceComment(agentResult, testOutput);
      await this.postComment(octokit, repoOwner, repoName, issueNumber, lowBody);

      return { action: 'comment_posted', commentBody: lowBody };
    } catch (err) {
      log.error({ err: String(err), issueNumber, repoOwner, repoName }, 'Error dispatching action');

      // Fallback: post error comment
      const errorBody = messages.errorComment(`Action dispatch failed: ${String(err)}`);
      try {
        await this.postComment(octokit, repoOwner, repoName, issueNumber, errorBody);
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
   * Post a comment to a GitHub issue using Octokit.
   * Logs context on failure and re-throws so callers can handle.
   */
  private async postComment(
    octokit: ReturnType<typeof getOctokit> extends Promise<infer T> ? T : never,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
    } catch (err) {
      log.warn({ err: String(err), owner, repo, issueNumber }, 'Failed to post comment to GitHub issue');
      throw err;
    }
  }
}
