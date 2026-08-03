// @ts-nocheck

import type { Octokit } from '@octokit/rest';
import type { ReceiptManifest } from '../types.js';

/**
 * ActionDispatcher — decides what action to take based on agent results.
 *
 * Thin wrapper that delegates to the platform abstraction layer for
 * message templates while keeping backward compatibility for consumers
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

import { captureEvent } from '../analytics/tracker.js';
import { config } from '../config.js';
import { addBreadcrumb, setUserContext } from '../monitoring/sentry.js';
import type { QualityGateReport } from '../pipeline/quality-gates.js';
import * as messages from '../platforms/messages.js';
import type { AgentResult, QualityGateResult } from '../types/agent-types.js';
import type { SandboxExecutor } from '../types/sandbox-types.js';
import { rootLogger } from '../utils/logger.js';
import { getOctokit } from './auth.js';

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
  receiptManifest?: ReceiptManifest;
  receiptsJson?: string;
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

      if (params.receiptManifest) {
        if (config.stas.mode === 'oss') {
          log.info({ issueNumber, mode: config.stas.mode }, 'OSS mode — skipping receipt verification gate');
        } else {
          const receiptCheck = verifyAllReceipts(params.receiptManifest);
          if (!receiptCheck.valid) {
            const missingList = receiptCheck.missing.join(', ');
            log.warn(
              { issueNumber, missingPhases: receiptCheck.missing },
              `Receipt gate blocked: missing receipts for phases: ${missingList}`,
            );
            await this.postComment(
              octokit,
              repoOwner,
              repoName,
              issueNumber,
              `### ❌ Receipt Gate Blocked — Missing Receipts\n\n` +
                `The following pipeline phases have no receipts:\n\n` +
                `${receiptCheck.missing.map((p) => `- \`${p}\``).join('\n')}\n\n` +
                `All phases must produce valid receipts before a PR can be created.\n\n` +
                `_Receipt manifest generated: ${params.receiptManifest.createdAt}_`,
            );
            return { action: 'comment_posted' };
          }
          log.info({ issueNumber }, 'Receipt gate passed — all phases have valid receipts');
        }
      }

      const qualityGates = agentResult.verification?.qualityGates;
      if (qualityGates && qualityGates.length > 0) {
        const failedGates = qualityGates.filter((g) => !g.passed);
        if (failedGates.length > 0) {
          log.warn(
            { issueNumber, failedGates: failedGates.map((g) => ({ gate: g.gate, tool: g.ossTool })) },
            `Quality gates blocked: ${failedGates.length} gate(s) failed`,
          );
          const body = messages.qualityGatesBlockComment(failedGates, agentResult.summary);
          await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
          return { action: 'comment_posted', commentBody: body };
        }
        log.info({ issueNumber }, 'All quality gates passed');
      }

      // 5. Push branch and gather changed files
      const branchName = `stas/fix-${issueNumber}-${Date.now().toString(36)}`;
      await sandbox.pushBranch(branchName);

      let changedFiles: string[] = [];
      let diffOutput = '';
      try {
        const diffResult = await sandbox.exec(
          // biome-ignore lint/suspicious/noExplicitAny: private field access needed
          `git -C ${(sandbox as { repoDir?: string }).repoDir || `/home/user/${repoName}`} diff origin/${baseBranch}...${branchName} 2>/dev/null || true`,
        );
        diffOutput = diffResult.stdout;
        changedFiles = diffOutput
          .split('\n')
          .filter(Boolean)
          .map((line) => line.trim())
          .filter((line) => !line.startsWith('diff --git'))
          .map((line) => line.replace(/^[+-]/, '').split('\t')[0])
          .filter(Boolean);
      } catch (err) {
        log.warn(
          { err: String(err), repoOwner, repoName, issueNumber },
          'Failed to gather changed files for PR body (non-fatal)',
        );
      }

      // 6a. Repo-side quality gate enforcement — block PR creation when repo-side gates fail
      let repoGateReport: QualityGateReport | null = null;
      try {
        const { runAllGates } = await import('../pipeline/quality-gates.js');
        repoGateReport = await runAllGates({
          sandbox,
          diff: diffOutput,
          execFn: (cmd: string, timeoutMs?: number) => sandbox.exec(cmd, timeoutMs),
        });
      } catch (err) {
        log.warn({ err: String(err), repoOwner, repoName, issueNumber }, 'Repo-side quality gates errored (non-fatal)');
      }

      if (repoGateReport && !repoGateReport.passed) {
        const failed = repoGateReport.gates.filter((g) => !g.passed);
        // Infra errors (empty stdout, 'Error' stderr) fail open; real gate failures carry output and fail closed.
        const infraFailures = failed.filter(
          (g) => g.stdout.trim() === '' && (g.stderr ?? '').trim().startsWith('Error'),
        );
        const realFailures = failed.filter((g) => !infraFailures.includes(g));

        if (realFailures.length === 0) {
          if (infraFailures.length > 0) {
            log.warn(
              { issueNumber, infraFailures: infraFailures.map((g) => g.gate) },
              'Repo-side quality gates unavailable (infra error) — proceeding',
            );
          }
        } else {
          const failedGates = realFailures.map((g) => ({
            gate: g.gate,
            passed: false,
            ossTool: g.error || 'repo-side',
            command: g.gate,
            stdout: g.stdout,
            stderr: g.stderr,
            details: g.details,
          }));
          log.warn(
            {
              issueNumber,
              failedGates: failedGates.map((g) => g.gate),
            },
            `Repo-side quality gates blocked: ${failedGates.length} gate(s) failed`,
          );
          const body = messages.qualityGatesBlockComment(failedGates, agentResult.summary);
          await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
          return { action: 'comment_posted', commentBody: body };
        }
      }

      // 6b. Repo-side deterministic quality gates — the 6 gates from
      // scripts/quality-gates.sh enforced against the agent's repo before PR
      // creation (mirrors the CLI so /api/quality and the fix flow agree).
      if (config.github.prQualityGate) {
        try {
          const { runRepoQualityGates } = await import('../pipeline/repoQualityGates.js');
          const repoDir = (sandbox as { repoDir?: string }).repoDir || `/home/user/${repoName}`;
          const execFn = async (cmd: string, timeoutMs?: number) => {
            const r = await sandbox.exec(cmd, timeoutMs);
            return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0 };
          };
          const report = await runRepoQualityGates({ execFn, repoDir, timeoutMs: 300_000 });
          if (!report.passed) {
            const failedGates: QualityGateResult[] = report.gates
              .filter((g) => !g.passed)
              .map((g) => ({
                gate: g.gate,
                passed: false,
                ossTool: `repo-quality-gate/${g.gate}`,
                command: g.gate,
                stdout: g.stdout.slice(0, 1000),
                stderr: g.stderr.slice(0, 1000),
                details: g.details,
              }));
            log.warn(
              { issueNumber, failedGates: failedGates.map((g) => g.gate) },
              `Repo quality gates blocked: ${failedGates.length} gate(s) failed`,
            );
            const body = messages.qualityGatesBlockComment(failedGates, agentResult.summary);
            await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
            return { action: 'comment_posted', commentBody: body };
          }
          log.info({ issueNumber, summary: report.summary }, 'Repo quality gates passed');
        } catch (err) {
          log.warn({ err: String(err), issueNumber }, 'Repo quality gates errored (non-fatal)');
        }
      }

      // 7a. Pre-existing tests regressed — block PR creation, branch already pushed
      if (agentResult.verification?.preExistingTestsRegressed) {
        const body = messages.regressionBlockComment(agentResult);
        await this.postComment(octokit, repoOwner, repoName, issueNumber, body);
        return { action: 'comment_posted', commentBody: body };
      }

      // 7b. Create PR based on confidence
      if (agentResult.confidence === 'high') {
        // Create a non-draft PR
        const prBody = messages.buildPRBody({
          issueNumber,
          result: agentResult,
          fileLinks: changedFiles,
          isDraft: false,
          branchName,
          ...(params.receiptManifest ? { receiptManifest: params.receiptManifest } : {}),
        } as any);

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

        addBreadcrumb('pr', 'High-confidence PR created', {
          prNumber: String(pr.data.number),
          prUrl: pr.data.html_url,
          repo: `${repoOwner}/${repoName}`,
          issueNumber: String(issueNumber),
          confidence: 'high',
        });

        this.trackFooterImpressions(issueNumber, repoOwner, repoName, installationId);

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
          ...(params.receiptManifest ? { receiptManifest: params.receiptManifest } : {}),
        } as any);

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

        addBreadcrumb('pr', 'Draft PR created', {
          prNumber: String(pr.data.number),
          prUrl: pr.data.html_url,
          repo: `${repoOwner}/${repoName}`,
          issueNumber: String(issueNumber),
          confidence: 'medium',
        });

        this.trackFooterImpressions(issueNumber, repoOwner, repoName, installationId);

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

      addBreadcrumb('pr', 'PR creation failed', {
        repo: `${repoOwner}/${repoName}`,
        issueNumber: String(issueNumber),
        error: String(err),
      });

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
   * Track a `pr_footer_impression` PostHog event for each footer placement
   * (PR body and issue comment) when the powered-by footer is enabled.
   */
  private trackFooterImpressions(
    issueNumber: number,
    repoOwner: string,
    repoName: string,
    installationId: number,
  ): void {
    if (!config.stas.poweredByFooterEnabled) return;
    const props = { repoOwner, repoName, issueNumber };
    captureEvent('pr_footer_impression', String(installationId), { ...props, placement: 'pr-body' });
    captureEvent('pr_footer_impression', String(installationId), { ...props, placement: 'pr-comment' });
  }

  /**
   * Post a comment to a GitHub issue using Octokit.
   * Logs context on failure and re-throws so callers can handle.
   */
  private async postComment(
    octokit: Octokit,
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
