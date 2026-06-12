/**
 * GitLab platform configuration.
 *
 * Reads GITLAB_URL and GITLAB_TOKEN from the global config and exposes
 * them in a form the registry and platform client can consume.
 */

import { config } from '../../config.js';
import type { PlatformConfig as BasePlatformConfig } from '../interface.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-gitlab-config' });

export interface GitLabPlatformConfig extends BasePlatformConfig {
  platform: 'gitlab';
  token: string;
  baseUrl: string;
}

/**
 * Build the GitLab PlatformConfig from the application config.
 *
 * Returns undefined if GitLab is not configured (no token).
 */
export function getGitLabPlatformConfig(): GitLabPlatformConfig | undefined {
  const token = config.gitlab.token;
  if (!token) {
    log.warn('GitLab token not configured — set GITLAB_TOKEN env var');
    return undefined;
  }

  return {
    platform: 'gitlab',
    token,
    baseUrl: config.gitlab.url ?? 'https://gitlab.com',
  };
}
