/**
 * GitLab PlatformClient implementation.
 *
 * Implements the PlatformClient interface for GitLab using Personal Access
 * Token (PAT) authentication. Supports self-hosted GitLab instances via
 * configurable baseUrl.
 *
 * API docs: https://docs.gitlab.com/ee/api/
 */

import { rootLogger } from '../../utils/logger.js';
import type { PlatformClient, Issue, PR, CreatePRParams, StatusParams } from '../interface.js';

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
 * GitLab implementation of PlatformClient.
 *
 * Authenticates via Private-Token header (Personal Access Token).
 * Base URL is configurable for self-hosted GitLab instances.
 */
export class GitLabPlatformClient implements PlatformClient {
  readonly platform = 'gitlab' as const;

  private readonly baseUrl: string;
  private readonly token: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = (baseUrl || 'https://gitlab.com').replace(/\/+$/, '');
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Make a GitLab API request.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text, method, path }, 'GitLab API request failed');
      throw new Error(`GitLab API error ${response.status}: ${text}`);
    }

    // 204 No Content responses have no body
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * URL-encode a project path for use in API endpoints.
   * GitLab requires `/` to be encoded as `%2F` in project paths.
   */
  private encodeProject(repo: string): string {
    return encodeURIComponent(repo);
  }

  // ── Issue operations ──────────────────────────────────────────────

  async getIssue(repo: string, issueNumber: number): Promise<Issue> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = this.encodeProject(`${owner}/${repoName}`);
    const data = await this.request<Record<string, unknown>>(
      'GET',
      `/projects/${project}/issues/${issueNumber}`,
    );

    return {
      id: data.id as number,
      number: data.iid as number,
      title: data.title as string,
      body: (data.description as string) || null,
      labels: ((data.labels as string[]) || []).map((l) => (typeof l === 'string' ? l : (l as Record<string, string>).title ?? String(l))),
      repoOwner: owner,
      repoName,
      state: data.state as string,
    };
  }

  async createComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = this.encodeProject(`${owner}/${repoName}`);

    await this.request<void>(
      'POST',
      `/projects/${project}/issues/${issueNumber}/notes`,
      { body },
    );

    log.info({ repo, issueNumber }, 'GitLab comment created');
  }

  async updateIssue(repo: string, issueNumber: number, updates: Partial<Issue>): Promise<void> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = this.encodeProject(`${owner}/${repoName}`);

    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.body !== undefined) body.description = updates.body;
    if (updates.state !== undefined) body.state = updates.state;
    if (updates.labels !== undefined) body.labels = updates.labels;

    await this.request<void>(
      'PUT',
      `/projects/${project}/issues/${issueNumber}`,
      body,
    );

    log.info({ repo, issueNumber, updates: Object.keys(updates) }, 'GitLab issue updated');
  }

  // ── MR operations ─────────────────────────────────────────────────

  async createPullRequest(params: CreatePRParams): Promise<PR> {
    const { repoOwner, repoName, title, head, base, body, draft } = params;
    const project = this.encodeProject(`${repoOwner}/${repoName}`);

    const requestBody: Record<string, unknown> = {
      source_branch: head,
      target_branch: base,
      title,
      description: body,
    };
    if (draft) {
      // GitLab uses "Draft:" prefix for draft MRs (or WIP: on older instances)
      requestBody.title = `Draft: ${title}`;
    }

    const data = await this.request<Record<string, unknown>>(
      'POST',
      `/projects/${project}/merge_requests`,
      requestBody,
    );

    const mr = {
      url: data.web_url as string,
      number: data.iid as number,
      title: data.title as string,
      state: (data.state === 'merged' ? 'merged' : data.state === 'closed' ? 'closed' : 'open') as 'open' | 'closed' | 'merged',
    };

    log.info({ repo: `${repoOwner}/${repoName}`, mrNumber: mr.number }, 'GitLab MR created');
    return mr;
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PR> {
    const { owner, repo: repoName } = parseRepo(repo);
    const project = this.encodeProject(`${owner}/${repoName}`);

    const data = await this.request<Record<string, unknown>>(
      'GET',
      `/projects/${project}/merge_requests/${prNumber}`,
    );

    return {
      url: data.web_url as string,
      number: data.iid as number,
      title: data.title as string,
      state: (data.state === 'merged' ? 'merged' : data.state === 'closed' ? 'closed' : 'open') as 'open' | 'closed' | 'merged',
    };
  }

  // ── Commit status ─────────────────────────────────────────────────

  async setStatus(params: StatusParams): Promise<void> {
    const { repoOwner, repoName, sha, state, description, targetUrl } = params;
    const project = this.encodeProject(`${repoOwner}/${repoName}`);

    const body: Record<string, unknown> = {
      state,
    };
    if (description !== undefined) body.description = description;
    if (targetUrl !== undefined) body.target_url = targetUrl;

    await this.request<void>(
      'POST',
      `/projects/${project}/statuses/${sha}`,
      body,
    );

    log.info({ repo: `${repoOwner}/${repoName}`, sha: sha.slice(0, 8), state }, 'GitLab commit status set');
  }

  // ── User info ─────────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<string> {
    const data = await this.request<Record<string, unknown>>('GET', '/user');
    return data.username as string;
  }
}

/**
 * Create a GitLab PlatformClient from config.
 *
 * @param token   GitLab Personal Access Token
 * @param baseUrl GitLab instance URL (default: https://gitlab.com)
 * @returns A configured GitLabPlatformClient
 */
export function createGitLabClient(token: string, baseUrl?: string): GitLabPlatformClient {
  return new GitLabPlatformClient(token, baseUrl);
}
