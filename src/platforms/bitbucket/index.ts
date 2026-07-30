/**
 * Bitbucket PlatformClient implementation.
 *
 * Makes REST API calls to Bitbucket Cloud using Basic auth.
 * API docs: https://developer.atlassian.com/bitbucket/api/2/reference/
 */

import type { PlatformClient, Issue, PR, CreatePRParams, StatusParams } from '../interface.js';
import type { PlatformWebhookEvent } from '../../webhooks/base.js';
import type { IssueJobData } from '../../utils/types.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-bitbucket' });

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
 * Parse token as "username:app-password" or use raw Basic header value.
 * The PlatformConfig token for Bitbucket should be "username:appPassword".
 */
function parseToken(token: string): { username: string; appPassword: string } {
  const colonIdx = token.indexOf(':');
  if (colonIdx === -1) {
    // Treat the whole token as a Basic auth header value
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    return { username: parts[0] ?? '', appPassword: parts.slice(1).join(':') };
  }
  return {
    username: token.slice(0, colonIdx),
    appPassword: token.slice(colonIdx + 1),
  };
}

/**
 * Bitbucket implementation of PlatformClient.
 */
export class BitbucketPlatformClient implements PlatformClient {
  readonly platform = 'bitbucket' as const;

  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(token: string, baseUrl?: string) {
    const { username, appPassword } = parseToken(token);
    this.baseUrl = baseUrl ?? 'https://api.bitbucket.org/2.0';
    const encoded = Buffer.from(`${username}:${appPassword}`).toString('base64');
    this.authHeader = `Basic ${encoded}`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      throw new Error(`Bitbucket API ${method} ${path} failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }

  // ── Issue operations ──────────────────────────────────────────────

  async getIssue(repo: string, issueNumber: number): Promise<Issue> {
    const { owner, repo: repoName } = parseRepo(repo);
    const data = await this.request<any>('GET', `/repositories/${owner}/${repoName}/issues/${issueNumber}`);

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.content?.raw ?? null,
      labels: [], // Bitbucket issues don't have labels in the same way
      repoOwner: owner,
      repoName,
      state: data.state,
    };
  }

  async createComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    await this.request('POST', `/repositories/${owner}/${repoName}/issues/${issueNumber}/comments`, {
      content: { raw: body },
    });
  }

  async updateIssue(repo: string, issueNumber: number, updates: Partial<Issue>): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    const params: Record<string, unknown> = {};
    if (updates.title !== undefined) params.title = updates.title;
    if (updates.body !== undefined) params.content = { raw: updates.body };
    if (updates.state !== undefined) params.state = updates.state;
    await this.request('PUT', `/repositories/${owner}/${repoName}/issues/${issueNumber}`, params);
  }

  // ── PR operations ─────────────────────────────────────────────────

  async createPullRequest(params: CreatePRParams): Promise<PR> {
    const data = await this.request<any>(
      'POST',
      `/repositories/${params.repoOwner}/${params.repoName}/pullrequests`,
      {
        title: params.title,
        description: params.body,
        source: { branch: { name: params.head } },
        destination: { branch: { name: params.base } },
      },
    );

    return {
      url: data.links?.html?.href ?? '',
      number: data.id,
      title: data.title,
      state: data.state === 'MERGED' ? 'merged' : data.state === 'DECLINED' || data.state === 'CLOSED' ? 'closed' : 'open',
    };
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PR> {
    const { owner, repo: repoName } = parseRepo(repo);
    const data = await this.request<any>('GET', `/repositories/${owner}/${repoName}/pullrequests/${prNumber}`);

    return {
      url: data.links?.html?.href ?? '',
      number: data.id,
      title: data.title,
      state: data.state === 'MERGED' ? 'merged' : data.state === 'DECLINED' || data.state === 'CLOSED' ? 'closed' : 'open',
    };
  }

  // ── Commit status (Bitbucket uses Pipelines/Commits) ──────────────

  async setStatus(params: StatusParams): Promise<void> {
    // Bitbucket doesn't have a direct "commit status" API in the same way as GitHub.
    // Commit statuses are set via Pipelines.
    // We log a warning and skip for now — this is a best-effort operation.
    log.warn(
      { repoOwner: params.repoOwner, repoName: params.repoName, sha: params.sha },
      'setStatus not directly supported on Bitbucket — consider using Pipelines',
    );
  }

  // ── Issue job data ────────────────────────────────────────────────

  toIssueJobData(event: PlatformWebhookEvent): IssueJobData {
    return {
      installationId: 0,
      repoOwner: event.issue.repoOwner,
      repoName: event.issue.repoName,
      repoPrivate: event.issue.repoPrivate,
      issueNumber: event.issue.number,
      issueTitle: event.issue.title,
      issueBody: event.issue.body,
      source: 'bitbucket',
    };
  }

  // ── User info ─────────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<string> {
    const data = await this.request<{ username: string }>('GET', '/user');
    return data.username;
  }
}
