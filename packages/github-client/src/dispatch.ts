import type { Octokit } from '@octokit/rest';
import { buildPRBody } from './messages.js';
import type { AgentResult } from './messages.js';

export interface DispatchConfig {
  octokit: Octokit;
  postComment: (issueNumber: number, body: string) => Promise<void>;
  pushBranch: (branchName: string) => Promise<void>;
  getChangedFiles?: (branchName: string, baseBranch: string) => Promise<string[]>;
  addBreadcrumb?: (category: string, message: string, data?: Record<string, string>) => void;
  log?: { info: (msg: object, msgText: string) => void; warn: (msg: object, msgText: string) => void; error: (msg: object, msgText: string) => void };
}

export interface DispatchParams {
  issueNumber: number;
  issueTitle: string;
  agentResult: AgentResult;
  repoOwner: string;
  repoName: string;
  baseBranch?: string;
  botName?: string;
}

export interface DispatchResult {
  action: 'pr_created' | 'draft_pr_created' | 'comment_posted' | 'error';
  prUrl?: string;
  prNumber?: number;
  commentBody?: string;
}

const log = {
  info: (_msg: object, _text: string) => {},
  warn: (_msg: object, _text: string) => {},
  error: (_msg: object, _text: string) => {},
};

export async function dispatchAction(config: DispatchConfig, params: DispatchParams): Promise<DispatchResult> {
  const { octokit, pushBranch, getChangedFiles, addBreadcrumb, log: logger } = config;
  const { issueNumber, issueTitle, agentResult, repoOwner, repoName, baseBranch, botName } = params;
  const l = logger ?? log;
  const bb = baseBranch || 'main';

  try {
    if (agentResult.alreadyFixed) {
      l.info({ issueNumber }, 'Issue already fixed — silent skip');
      return { action: 'comment_posted' };
    }

    if (!agentResult.fixReady) {
      l.info({ issueNumber }, 'No fix possible — silent skip');
      return { action: 'comment_posted' };
    }

    if (agentResult.investigationOnly) {
      l.info({ issueNumber }, 'Investigation only — silent skip');
      return { action: 'comment_posted' };
    }

    const branchName = `stas/fix-${issueNumber}-${Date.now().toString(36)}`;
    await pushBranch(branchName);

    let changedFiles: string[] = [];
    if (getChangedFiles) {
      try {
        changedFiles = await getChangedFiles(branchName, bb);
      } catch (err) {
        l.warn({ err: String(err), issueNumber }, 'Failed to gather changed files (non-fatal)');
      }
    }

    if (agentResult.verification?.preExistingTestsRegressed) {
      l.warn({ issueNumber }, 'Pre-existing tests regressed — PR blocked silently');
      return { action: 'comment_posted' };
    }

    if (agentResult.confidence === 'high') {
      const prBody = buildPRBody({ issueNumber, result: agentResult, fileLinks: changedFiles, isDraft: false, branchName, botName });
      const pr = await octokit.pulls.create({ owner: repoOwner, repo: repoName, title: `Fix: ${issueTitle}`, head: branchName, base: bb, body: prBody });
      l.info({ prNumber: pr.data.number }, 'High-confidence PR created');
      addBreadcrumb?.('pr', 'High-confidence PR created', { prNumber: String(pr.data.number), prUrl: pr.data.html_url, repo: `${repoOwner}/${repoName}`, issueNumber: String(issueNumber), confidence: 'high' });
      return { action: 'pr_created', prUrl: pr.data.html_url, prNumber: pr.data.number };
    }

    if (agentResult.confidence === 'medium') {
      const prBody = buildPRBody({ issueNumber, result: agentResult, fileLinks: changedFiles, isDraft: true, branchName, botName });
      const pr = await octokit.pulls.create({ owner: repoOwner, repo: repoName, title: `[WIP] Fix: ${issueTitle}`, head: branchName, base: bb, body: prBody, draft: true });
      l.info({ prNumber: pr.data.number }, 'Draft PR created');
      addBreadcrumb?.('pr', 'Draft PR created', { prNumber: String(pr.data.number), prUrl: pr.data.html_url, repo: `${repoOwner}/${repoName}`, issueNumber: String(issueNumber), confidence: 'medium' });
      return { action: 'draft_pr_created', prUrl: pr.data.html_url, prNumber: pr.data.number };
    }

    l.info({ issueNumber }, 'Low confidence fix — no PR created');
    return { action: 'comment_posted' };
  } catch (err) {
    l.error({ err: String(err), issueNumber }, 'Error dispatching action');
    addBreadcrumb?.('pr', 'PR creation failed', { issueNumber: String(issueNumber), error: String(err) });
    return { action: 'error' };
  }
}
