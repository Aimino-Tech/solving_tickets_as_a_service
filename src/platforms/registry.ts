/**
 * PlatformClient registry — factory that returns the right client for a
 * given platform configuration.
 *
 * Usage:
 *   const client = getClient({ platform: 'github', token: '…' });
 *   const issue = await client.getIssue('owner/repo', 42);
 */

import type { PlatformClient, PlatformConfig } from './interface.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'platform-registry' });

/**
 * Get a PlatformClient for the given configuration.
 *
 * For GitHub, the `token` in PlatformConfig is ignored; use
 * `createGitHubClient(installationId)` instead, which authenticates
 * via GitHub App installation tokens.
 *
 * For GitLab and Bitbucket, the `token` is used directly.
 *
 * @throws If the platform is unknown or unsupported.
 */
export async function getClient(config: PlatformConfig): Promise<PlatformClient> {
  switch (config.platform) {
    case 'github': {
      // Dynamic import to avoid circular deps with src/github/auth.ts
      const { GitHubPlatformClient } = await import('./github/index.js');
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: config.token });
      return new GitHubPlatformClient(octokit, 0);
    }

    case 'gitlab': {
      const { GitLabPlatformClient } = await import('./gitlab/index.js');
      return new GitLabPlatformClient(config.token, config.baseUrl);
    }

    case 'bitbucket': {
      const { BitbucketPlatformClient } = await import('./bitbucket/index.js');
      return new BitbucketPlatformClient(config.token, config.baseUrl);
    }

    default: {
      const ex: never = config.platform;
      const msg = `Unknown platform: ${ex}`;
      log.error({ platform: config.platform }, msg);
      throw new Error(msg);
    }
  }
}
