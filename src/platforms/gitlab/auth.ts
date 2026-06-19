/**
 * GitLab authentication wrapper — token-based auth for the GitLab API.
 *
 * Wraps the PAT (personal access token) configured via environment variables
 * so the rest of the platform layer does not need to know about config keys.
 */

import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-gitlab-auth' });

export interface GitLabAuth {
  /** The GitLab API base URL (e.g. https://gitlab.com/api/v4). */
  readonly baseUrl: string;

  /** The private token used in PRIVATE-TOKEN headers. */
  readonly token: string;

  /** Check whether auth is configured and available. */
  isConfigured(): boolean;
}

let _auth: GitLabAuth | undefined;

/**
 * Initialise GitLab auth from config.
 * Must be configured with GITLAB_URL and GITLAB_TOKEN.
 */
function createAuth(): GitLabAuth {
  const baseUrl = `${config.gitlab.url.replace(/\/+$/, '')}/api/v4`;
  const token = config.gitlab.token;

  if (!token) {
    log.warn('GitLab token not configured — set GITLAB_TOKEN env var');
  }

  return {
    baseUrl,
    token,
    isConfigured() {
      return Boolean(this.token);
    },
  };
}

/**
 * Get the shared GitLabAuth instance (lazily initialised).
 */
export function getGitLabAuth(): GitLabAuth {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}

/**
 * Reset the cached auth (useful in tests).
 */
export function resetGitLabAuth(): void {
  _auth = undefined;
}
