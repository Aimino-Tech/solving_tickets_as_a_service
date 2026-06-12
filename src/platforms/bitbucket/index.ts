import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';
import type { IssueJobData } from '../../utils/types.js';
import type { CreatePullRequestParams, PlatformClient, PlatformWebhookEvent } from '../../webhooks/base.js';
import { bitbucketCache, CACHE_TTL } from './cache.js';
import { createBitbucketConfig } from './config.js';

const log = rootLogger.child({ module: 'platform-bitbucket' });

const bbConfig = createBitbucketConfig();

function getAuthHeader(): string {
  const encoded = Buffer.from(`${bbConfig.username}:${bbConfig.appPassword}`).toString('base64');
  return `Basic ${encoded}`;
}

function buildUrl(path: string): string {
  return `${bbConfig.apiBaseUrl}${path}`;
}

async function apiGet<T>(path: string, cacheKey: string, cacheTtl: number): Promise<T> {
  const cached = bitbucketCache.get<T>(cacheKey);
  if (cached !== undefined) return cached;

  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    log.error({ status: response.status, body: text, url }, 'Bitbucket GET failed');
    throw new Error(`Bitbucket GET ${path} failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as T;
  bitbucketCache.set(cacheKey, data, cacheTtl);
  return data;
}

async function apiPost<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error({ status: response.status, body: text, url }, 'Bitbucket POST failed');
    throw new Error(`Bitbucket POST ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as TResponse;
}

interface BitbucketIssue {
  id: number;
  title: string;
  content?: { raw: string } | null;
  state: string;
  kind: string;
  priority: string;
  repository?: { name: string };
  links?: { html?: { href: string } };
}

interface BitbucketComment {
  id: number;
  content?: { raw: string };
  user?: { display_name: string };
  created_on: string;
}

interface BitbucketPullRequest {
  id: number;
  title: string;
  description?: string;
  state: string;
  links: { html: { href: string } };
  source: { branch: { name: string } };
  destination: { branch: { name: string } };
  created_on?: string;
}

interface BitbucketBuildStatus {
  key: string;
  state: string;
  name?: string;
  url?: string;
  description?: string;
}

async function getIssueImpl(
  repoOwner: string,
  repoName: string,
  issueId: number,
): Promise<BitbucketIssue> {
  const path = `/repositories/${repoOwner}/${repoName}/issues/${issueId}`;
  const cacheKey = `issue:${repoOwner}/${repoName}#${issueId}`;
  return apiGet<BitbucketIssue>(path, cacheKey, CACHE_TTL.ISSUE_CONTENT);
}

async function createCommentImpl(
  repoOwner: string,
  repoName: string,
  issueNumber: number,
  body: string,
  resourceType: 'issues' | 'pullrequests' = 'issues',
): Promise<BitbucketComment> {
  const path = `/repositories/${repoOwner}/${repoName}/${resourceType}/${issueNumber}/comments`;
  return apiPost(path, { content: { raw: body } });
}

async function createPullRequestImpl(
  repoOwner: string,
  repoName: string,
  title: string,
  head: string,
  base: string,
  body: string,
): Promise<{ url: string; number: number }> {
  const path = `/repositories/${repoOwner}/${repoName}/pullrequests`;
  const pr = await apiPost<
    {
      title: string;
      description: string;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
    },
    BitbucketPullRequest
  >(path, {
    title,
    description: body,
    source: { branch: { name: head } },
    destination: { branch: { name: base } },
  });
  return { url: pr.links.html.href, number: pr.id };
}

async function setStatusImpl(
  repoOwner: string,
  repoName: string,
  sha: string,
  state: 'INPROGRESS' | 'SUCCESSFUL' | 'FAILED' | 'STOPPED',
  key: string,
  name: string,
  url?: string,
  description?: string,
): Promise<BitbucketBuildStatus> {
  const path = `/repositories/${repoOwner}/${repoName}/commit/${sha}/statuses/build`;
  return apiPost(path, {
    key,
    state,
    name,
    url: url || '',
    description: description || '',
  });
}

export const bitbucketPlatformClient: PlatformClient & {
  getIssue(repoOwner: string, repoName: string, issueId: number): Promise<{
    id: number;
    title: string;
    body: string | null;
    state: string;
    kind: string;
    priority: string;
  }>;
  setStatus(
    repoOwner: string,
    repoName: string,
    sha: string,
    state: 'INPROGRESS' | 'SUCCESSFUL' | 'FAILED' | 'STOPPED',
    key: string,
    name: string,
    url?: string,
    description?: string,
  ): Promise<{ key: string; state: string; name?: string; url?: string; description?: string }>;
  createPrComment(
    repoOwner: string,
    repoName: string,
    prNumber: number,
    body: string,
  ): Promise<void>;
} = {
  platform: 'bitbucket',

  async getIssue(
    repoOwner: string,
    repoName: string,
    issueId: number,
  ): Promise<{
    id: number;
    title: string;
    body: string | null;
    state: string;
    kind: string;
    priority: string;
  }> {
    const issue = await getIssueImpl(repoOwner, repoName, issueId);
    return {
      id: issue.id,
      title: issue.title,
      body: issue.content?.raw ?? null,
      state: issue.state,
      kind: issue.kind,
      priority: issue.priority,
    };
  },

  async createComment(
    repoOwner: string,
    repoName: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    await createCommentImpl(repoOwner, repoName, issueNumber, body, 'issues');
  },

  async createPrComment(
    repoOwner: string,
    repoName: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    await createCommentImpl(repoOwner, repoName, prNumber, body, 'pullrequests');
  },

  async createPullRequest(params: CreatePullRequestParams): Promise<{ url: string; number: number }> {
    return createPullRequestImpl(
      params.repoOwner,
      params.repoName,
      params.title,
      params.head,
      params.base,
      params.body,
    );
  },

  async setStatus(
    repoOwner: string,
    repoName: string,
    sha: string,
    state: 'INPROGRESS' | 'SUCCESSFUL' | 'FAILED' | 'STOPPED',
    key: string,
    name: string,
    url?: string,
    description?: string,
  ): Promise<{ key: string; state: string; name?: string; url?: string; description?: string }> {
    return setStatusImpl(repoOwner, repoName, sha, state, key, name, url, description);
  },

  toIssueJobData(event: PlatformWebhookEvent): IssueJobData {
    return {
      installationId: Number(event.issue.installationId ?? 0),
      repoOwner: event.issue.repoOwner,
      repoName: event.issue.repoName,
      repoPrivate: event.issue.repoPrivate,
      issueNumber: event.issue.number,
      issueTitle: event.issue.title,
      issueBody: event.issue.body,
      source: 'bitbucket',
    };
  },
};
