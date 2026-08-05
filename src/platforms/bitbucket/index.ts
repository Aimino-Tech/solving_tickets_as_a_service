/**
 * Bitbucket PlatformClient implementation.
 *
 * Makes REST API calls to Bitbucket Cloud using Basic auth.
 * API docs: https://developer.atlassian.com/bitbucket/api/2/reference/
 */

import { rootLogger } from '../../utils/logger.js';
import type { CreatePRParams, Issue, PlatformClient, PR, StatusParams } from '../interface.js';

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
 * Parse credentials for Bitbucket Cloud.
 *
 * - `bearer:<token>` or a raw token with no `:` → Bearer auth (workspace/repo access tokens)
 * - `email:token` or `username:appPassword` → Basic auth (Atlassian API tokens / legacy app passwords)
 */
function parseAuth(token: string): { authorization: string } {
  const trimmed = token.trim();
  if (/^bearer\s+/i.test(trimmed)) {
    return { authorization: `Bearer ${trimmed.replace(/^bearer\s+/i, '').trim()}` };
  }
  if (trimmed.toLowerCase().startsWith('bearer:')) {
    return { authorization: `Bearer ${trimmed.slice('bearer:'.length).trim()}` };
  }
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    // Token-only → Bearer (no email/username required in the client)
    return { authorization: `Bearer ${trimmed}` };
  }
  const username = trimmed.slice(0, colonIdx);
  const secret = trimmed.slice(colonIdx + 1);
  // Sentinel stored when connect succeeded via Bearer
  if (username === 'bearer' || username === '') {
    return { authorization: `Bearer ${secret}` };
  }
  return { authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}` };
}

/**
 * Bitbucket implementation of PlatformClient.
 */
export class BitbucketPlatformClient implements PlatformClient {
  readonly platform = 'bitbucket' as const;

  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(token: string, baseUrl?: string) {
    const raw = baseUrl ?? 'https://api.bitbucket.org/2.0';
    this.baseUrl = raw.includes('/2.0') ? raw.replace(/\/$/, '') : `${raw.replace(/\/$/, '')}/2.0`;
    this.authHeader = parseAuth(token).authorization;
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
      let bitbucketMessage = text;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        if (typeof parsed.error === 'string') {
          bitbucketMessage = parsed.error;
        } else {
          bitbucketMessage = parsed.error?.message ?? parsed.message ?? text;
        }
      } catch {
        /* keep raw text */
      }
      const err = new Error(`Bitbucket API error: ${bitbucketMessage}`);
      (err as Error & { status?: number; bitbucketMessage?: string }).status = response.status;
      (err as Error & { bitbucketMessage?: string }).bitbucketMessage = bitbucketMessage;
      throw err;
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
    const data = await this.request<any>('POST', `/repositories/${params.repoOwner}/${params.repoName}/pullrequests`, {
      title: params.title,
      description: params.body,
      source: { branch: { name: params.head } },
      destination: { branch: { name: params.base } },
      draft: params.draft ?? false,
    });

    return {
      url: data.links?.html?.href ?? '',
      number: data.id,
      title: data.title,
      state:
        data.state === 'MERGED' ? 'merged' : data.state === 'DECLINED' || data.state === 'CLOSED' ? 'closed' : 'open',
    };
  }

  // ── Repository / webhook operations ────────────────────────────────

  async listWorkspaces(): Promise<Array<{ slug: string; name: string }>> {
    // CHANGE-2770 / CHANGE-3022: use /user/workspaces (nested workspace object)
    const data = await this.request<any>('GET', '/user/workspaces?pagelen=100');
    const values = data.values ?? [];
    const mapped = values
      .map((entry: { workspace?: { slug?: string; name?: string }; slug?: string; name?: string }) => {
        const ws = entry.workspace ?? entry;
        const slug = ws.slug ?? '';
        return { slug, name: ws.name ?? slug };
      })
      .filter((w: { slug: string }) => w.slug.length > 0);
    if (mapped.length === 0) {
      log.warn(
        { rawCount: values.length, sample: values[0] ?? null },
        'Bitbucket /user/workspaces returned no usable slugs',
      );
    }
    return mapped;
  }

  async listRepos(
    workspace: string,
  ): Promise<Array<{ name: string; fullName: string; private: boolean; mainbranch: string }>> {
    // CHANGE-2770: GET /workspaces/{ws}/repositories was removed → use /repositories/{workspace}
    const data = await this.request<any>('GET', `/repositories/${workspace}?pagelen=100`);
    return (data.values ?? []).map(
      (r: { name?: string; full_name?: string; is_private?: boolean; mainbranch?: { name?: string } }) => ({
        name: r.name ?? '',
        fullName: r.full_name ?? `${workspace}/${r.name ?? ''}`,
        private: r.is_private ?? false,
        mainbranch: r.mainbranch?.name ?? 'main',
      }),
    );
  }

  async listWebhooks(workspace: string, repo: string): Promise<Array<{ uuid: string; url: string; active: boolean }>> {
    const data = await this.request<any>('GET', `/repositories/${workspace}/${repo}/hooks?pagelen=100`);
    return (data.values ?? []).map((h: { uuid?: string; url?: string; active?: boolean }) => ({
      uuid: h.uuid ?? '',
      url: h.url ?? '',
      active: h.active ?? false,
    }));
  }

  async createWebhook(workspace: string, repo: string, url: string, secret?: string): Promise<{ uuid: string }> {
    const body: Record<string, unknown> = {
      url,
      events: ['issue:created', 'issue:updated', 'pullrequest:created', 'pullrequest:updated'],
      active: true,
    };
    if (secret) body.secret = secret;
    const data = await this.request<any>('POST', `/repositories/${workspace}/${repo}/hooks`, body);
    return { uuid: data.uuid ?? '' };
  }

  async removeWebhook(workspace: string, repo: string, uuid: string): Promise<void> {
    await this.request('DELETE', `/repositories/${workspace}/${repo}/hooks/${uuid}`);
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PR> {
    const { owner, repo: repoName } = parseRepo(repo);
    const data = await this.request<any>('GET', `/repositories/${owner}/${repoName}/pullrequests/${prNumber}`);

    return {
      url: data.links?.html?.href ?? '',
      number: data.id,
      title: data.title,
      state:
        data.state === 'MERGED' ? 'merged' : data.state === 'DECLINED' || data.state === 'CLOSED' ? 'closed' : 'open',
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

  // ── User info ─────────────────────────────────────────────────────

  async getAuthenticatedUser(): Promise<string> {
    const data = await this.request<{ username: string }>('GET', '/user');
    return data.username;
  }
}
