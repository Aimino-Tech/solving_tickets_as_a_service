/**
 * GitLab PlatformClient implementation.
 *
 * Makes REST API calls to GitLab using a personal access token.
 * API docs: https://docs.gitlab.com/ee/api/
 */

import type { PlatformClient, Issue, PR, CreatePRParams, StatusParams } from '../interface.js';
import type { PlatformWebhookEvent } from '../../webhooks/base.js';
import type { IssueJobData } from '../../utils/types.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-gitlab' });

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
 * Encode a project path for the GitLab API (namespace/project → namespace%2Fproject).
 */
function encodeProject(repoOwner: string, repoName: string): string {
  return encodeURIComponent(`${repoOwner}/${repoName}`);
}

/**
 * GitLab implementation of PlatformClient.
 */
export class GitLabPlatformClient implements PlatformClient {
  readonly platform = 'gitlab' as const;

  private readonly baseUrl: string;
  private readonly token: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    // Default to GitLab.com
    this.baseUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/v4` : 'https://gitlab.com/api/v4';
  }

  private get headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.token,
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
      throw new Error(`GitLab API ${method} ${path} failed: ${response.status} ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ── Issue operations ──────────────────────────────────────────────

  async getIssue(repo: string, issueNumber: number): Promise<Issue> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = encodeProject(owner, repoName);
    const data = await this.request<any>('GET', `/projects/${project}/issues/${issueNumber}`);

    return {
      id: data.id,
      number: data.iid,
      title: data.title,
      body: data.description ?? null,
      labels: data.labels?.map((l: any) => (typeof l === 'string' ? l : l.title ?? '')) ?? [],
      repoOwner: owner,
      repoName,
      state: data.state,
    };
  }

  async createComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = encodeProject(owner, repoName);
    await this.request('POST', `/projects/${project}/issues/${issueNumber}/notes`, { body });
  }

  async updateIssue(repo: string, issueNumber: number, updates: Partial<Issue>): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = encodeProject(owner, repoName);
    const params: Record<string, unknown> = {};
    if (updates.title !== undefined) params.title = updates.title;
    if (updates.body !== undefined) params.description = updates.body;
    if (updates.state !== undefined) params.state = updates.state;
    if (updates.labels !== undefined) params.labels = updates.labels.join(',');
    await this.request('PUT', `/projects/${project}/issues/${issueNumber}`, params);
  }

  // ── MR operations ─────────────────────────────────────────────────

  async createPullRequest(params: CreatePRParams): Promise<PR> {
    const project = encodeProject(params.repoOwner, params.repoName);
    const data = await this.request<any>('POST', `/projects/${project}/merge_requests`, {
      source_branch: params.head,
      target_branch: params.base,
      title: params.title,
      description: params.body,
    });

    return {
      url: data.web_url,
      number: data.iid,
      title: data.title,
      state: data.state === 'merged' ? 'merged' : data.state === 'closed' ? 'closed' : 'open',
    };
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PR> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = encodeProject(owner, repoName);
    const data = await this.request<any>('GET', `/projects/${project}/merge_requests/${prNumber}`);

    return {
      url: data.web_url,
      number: data.iid,
      title: data.title,
      state: data.state === 'merged' ? 'merged' : data.state === 'closed' ? 'closed' : 'open',
    };
  }

  // ── Commit status (GitLab uses Pipelines) ─────────────────────────

  async setStatus(params: StatusParams): Promise<void> {
    const project = encodeProject(params.repoOwner, params.repoName);
    await this.request('POST', `/projects/${project}/statuses/${params.sha}`, {
      state: params.state,
      description: params.description ?? '',
      target_url: params.targetUrl ?? '',
    });
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
      source: 'gitlab',
    };
  }

  // ── User info ─────────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<string> {
    const data = await this.request<{ username: string }>('GET', '/user');
    return data.username;
  }
}
