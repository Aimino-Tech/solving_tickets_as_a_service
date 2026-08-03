import type { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pr-quality-gate' });

export interface PrOpenedPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    html_url: string;
    user?: { login: string };
    head: { sha: string };
    base: { ref: string };
  };
  repository: {
    owner: { login: string };
    name: string;
  };
  installation?: { id: number };
}

export interface CheckSuiteCompletedPayload {
  action: string;
  check_suite?: {
    status: string;
    conclusion?: string | null;
    head_sha: string;
    pull_requests?: Array<{ number: number }>;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
  installation?: { id: number };
}

const SYNTARO_PR_MARKER = 'Powered by Syntaro';

function isSyntaroPr(body?: string | null, headRepoLogin?: string | null, appLogin?: string): boolean {
  if (body?.includes(SYNTARO_PR_MARKER)) {
    return true;
  }
  if (appLogin && headRepoLogin === appLogin) {
    return true;
  }
  return false;
}

async function listExistingComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<string[]> {
  const { data: comments } = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number: pullNumber,
  });
  return comments.map((c) => c.body ?? '');
}

export async function requestReviewFromCollaborators(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  authorLogin?: string,
): Promise<void> {
  if (!config.github.autoRequestReview) {
    return;
  }
  try {
    const { data: collaborators } = await octokit.repos.listCollaborators({
      owner,
      repo,
      per_page: 100,
    });
    const reviewers = collaborators
      .filter((c) => c.login !== authorLogin && c.permissions?.push)
      .map((c) => c.login)
      .slice(0, config.github.reviewersCount);

    if (reviewers.length === 0) {
      log.debug({ owner, repo, pullNumber }, 'No eligible collaborators to request review from');
      return;
    }

    const existing = await listExistingComments(octokit, owner, repo, pullNumber);
    if (existing.some((c) => c.includes('Requested review from'))) {
      return;
    }

    await octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pullNumber,
      reviewers,
    });
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: `🔄 **Syntaro** requested review from: ${reviewers.map((r) => `@${r}`).join(', ')}`,
    });
    log.info({ owner, repo, pullNumber, reviewers }, 'Requested review from collaborators');
  } catch (err) {
    log.warn({ err: String(err), owner, repo, pullNumber }, 'Failed to request review from collaborators');
  }
}

async function isPrMerged(octokit: Octokit, owner: string, repo: string, pullNumber: number): Promise<boolean> {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
  return pr.merged || pr.state === 'closed';
}

async function enableMergeQueue(octokit: Octokit, owner: string, repo: string, pullNumber: number): Promise<void> {
  if (!config.github.mergeQueueEnabled) {
    return;
  }
  try {
    const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
    const prNodeId = pr.node_id;
    if (!prNodeId) {
      log.warn({ owner, repo, pullNumber }, 'No node_id for PR — cannot enable merge queue');
      return;
    }
    await octokit.graphql(
      `mutation enableAutoMerge($prId: ID!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $prId,
          mergeMethod: MERGE
        }) { pullRequest { id } }
      }`,
      { prId: prNodeId },
    );
    log.info({ owner, repo, pullNumber }, 'Enabled auto-merge (merge queue) for PR');
  } catch (err) {
    log.warn({ err: String(err), owner, repo, pullNumber }, 'Failed to enable auto-merge for PR');
  }
}

export async function handlePullRequestOpened(octokit: Octokit, payload: PrOpenedPayload): Promise<void> {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pullNumber = payload.number;

  if (payload.action !== 'opened') {
    return;
  }

  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });

  if (!isSyntaroPr(pr.body, pr.head?.repo?.owner?.login, pr.user?.login)) {
    return;
  }

  log.info(
    { owner, repo, pullNumber, prUrl: payload.pull_request.html_url },
    'Syntaro-created PR opened — running quality gate',
  );

  if (config.github.prQualityGate) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: '🔄 **Syntaro quality gate**: waiting for CI checks to pass before marking this PR ready to merge…',
    });
  }

  await requestReviewFromCollaborators(octokit, owner, repo, pullNumber, pr.user?.login);
}

export async function handleCheckSuiteCompleted(octokit: Octokit, payload: CheckSuiteCompletedPayload): Promise<void> {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const suite = payload.check_suite;

  if (!suite || payload.action !== 'completed') {
    return;
  }

  const prNumbers = suite.pull_requests?.map((pr) => pr.number) ?? [];
  if (prNumbers.length === 0) {
    return;
  }

  for (const pullNumber of prNumbers) {
    try {
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });

      if (!isSyntaroPr(pr.body, pr.head?.repo?.owner?.login, pr.user?.login)) {
        continue;
      }
      if (await isPrMerged(octokit, owner, repo, pullNumber)) {
        continue;
      }

      const existing = await listExistingComments(octokit, owner, repo, pullNumber);
      const gatePassed = existing.some((c) => c.includes('Syntaro quality gate passed'));
      const gateFailed = existing.some((c) => c.includes('Syntaro quality gate failed'));

      const conclusion = suite.conclusion ?? null;
      if (conclusion === 'success' && !gatePassed) {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: `✅ **Syntaro quality gate passed** — all CI checks are green. This PR is ready to merge.`,
        });
        await enableMergeQueue(octokit, owner, repo, pullNumber);
      } else if (conclusion !== 'success' && !gateFailed) {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: `❌ **Syntaro quality gate failed** — CI check suite concluded with \`${conclusion ?? 'pending'}\`. Review the checks before merging.`,
        });
      }
    } catch (err) {
      log.warn({ err: String(err), owner, repo, pullNumber }, 'Quality gate check failed for PR');
    }
  }
}
