/**
 * Platform abstraction interfaces — decouples the agent pipeline from
 * platform-specific (GitHub / GitLab / Bitbucket) API code.
 *
 * Every platform must implement PlatformClient, which the ActionDispatcher
 * and other pipeline components use to interact with the hosting platform.
 */

export type Platform = 'github' | 'gitlab' | 'bitbucket';

export type PullRequestState = 'open' | 'closed' | 'merged';

/**
 * Minimal config needed to create a PlatformClient via the registry.
 * Each platform implementation extracts what it needs from this.
 */
export interface PlatformConfig {
  platform: Platform;
  token: string;
  baseUrl?: string;
}

/**
 * Normalised issue from any platform.
 */
export interface Issue {
  id: number | string;
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  repoOwner: string;
  repoName: string;
  state?: string;
}

/**
 * Normalised pull request / merge request.
 */
export interface PR {
  url: string;
  number: number;
  title: string;
  state: PullRequestState;
}

/**
 * Parameters for creating a pull request / merge request.
 */
export interface CreatePRParams {
  repoOwner: string;
  repoName: string;
  title: string;
  head: string;
  base: string;
  body: string;
  draft?: boolean;
}

/**
 * Parameters for setting a commit status / pipeline state.
 */
export interface StatusParams {
  repoOwner: string;
  repoName: string;
  sha: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  description?: string;
  targetUrl?: string;
}

/**
 * PlatformClient — the unified interface every platform must implement.
 *
 * Methods use `repo` (as `"owner/name"`) where noted, or separate
 * `repoOwner` / `repoName` where the distinction matters.
 */
export interface PlatformClient {
  readonly platform: Platform;

  /** Fetch an issue by repo ("owner/name") and issue number. */
  getIssue(repo: string, issueNumber: number): Promise<Issue>;

  /** Create a comment on an issue. `repo` is "owner/name". */
  createComment(repo: string, issueNumber: number, body: string): Promise<void>;

  /** Update issue fields (labels, state, title, body, …). `repo` is "owner/name". */
  updateIssue(repo: string, issueNumber: number, updates: Partial<Issue>): Promise<void>;

  /** Create a pull request / merge request. */
  createPullRequest(params: CreatePRParams): Promise<PR>;

  /** Fetch an existing pull request / merge request. `repo` is "owner/name". */
  getPullRequest(repo: string, prNumber: number): Promise<PR>;

  /** Set a commit status / pipeline state. */
  setStatus(params: StatusParams): Promise<void>;

  /** Return the authenticated user or bot username. */
  getAuthenticatedUser(): Promise<string>;
}
