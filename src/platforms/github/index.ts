/**
 * GitHub PlatformClient implementation.
 *
 * Wraps Octokit (GitHub App installation tokens) behind the PlatformClient
 * interface so the rest of the pipeline speaks the abstraction layer.
 */

import type { Octokit } from '@octokit/rest';
import type { PlatformClient, Issue, PR, CreatePRParams, StatusParams } from '../interface.js';
import { getOctokit } from '../../github/auth.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-github' });

/**
 * Parse a `"owner/repo"` string into its components.
 */
function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format "${repo}" — expected "owner/repo"`);
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * GitHub implementation of PlatformClient.
 *
 * Requires an `installationId` to authenticate as a GitHub App installation.
 * Use `createGitHubClient()` to instantiate.
 */
export class GitHubPlatformClient implements PlatformClient {
  readonly platform = 'github' as const;

  private readonly octokit: Octokit;
  private readonly installationId: number;

  constructor(octokit: Octokit, installationId: number) {
    this.octokit = octokit;
    this.installationId = installationId;
  }

  // ── Issue operations ──────────────────────────────────────────────

  async getIssue(repo: string, issueNumber: number): Promise<Issue> {
    const { owner, repo: repoName } = parseRepo(repo);
    const response = await this.octokit.issues.get({
      owner,
      repo: repoName,
      issue_number: issueNumber,
    });
    const i = response.data;
    return {
      id: i.id,
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      labels: i.labels?.map((l) => (typeof l === 'string' ? l : l.name ?? '')) ?? [],
      repoOwner: owner,
      repoName,
      state: i.state,
    };
  }

  async createComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    await this.octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      body,
    });
  }

  async updateIssue(repo: string, issueNumber: number, updates: Partial<Issue>): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    await this.octokit.issues.update({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.body !== undefined && { body: updates.body }),
      ...(updates.state !== undefined && { state: updates.state }),
      ...(updates.labels !== undefined && { labels: updates.labels }),
    });
  }

  // ── PR operations ─────────────────────────────────────────────────

  async createPullRequest(params: CreatePRParams): Promise<PR> {
    const { repoOwner, repoName, title, head, base, body, draft } = params;
    const response = await this.octokit.pulls.create({
      owner: repoOwner,
      repo: repoName,
      title,
      head,
      base,
      body,
      draft,
    });
    const pr = response.data;
    return {
      url: pr.html_url,
      number: pr.number,
      title: pr.title,
      state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    };
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PR> {
    const { owner, repo: repoName } = parseRepo(repo);
    const response = await this.octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    const pr = response.data;
    return {
      url: pr.html_url,
      number: pr.number,
      title: pr.title,
      state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    };
  }

  // ── Commit status ─────────────────────────────────────────────────

  async setStatus(params: StatusParams): Promise<void> {
    const { repoOwner, repoName, sha, state, description, targetUrl } = params;
    await this.octokit.repos.createCommitStatus({
      owner: repoOwner,
      repo: repoName,
      sha,
      state,
      description: description ?? '',
      target_url: targetUrl ?? '',
    });
  }

  // ── User info ─────────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<string> {
    const { data } = await this.octokit.users.getAuthenticated();
    return data.login;
  }
}

/**
 * Create a GitHub PlatformClient for a given installation.
 *
 * @param installationId  GitHub App installation ID
 * @returns A configured GitHubPlatformClient
 */
export async function createGitHubClient(installationId: number): Promise<GitHubPlatformClient> {
  const octokit = await getOctokit(installationId);
  return new GitHubPlatformClient(octokit, installationId);
}
