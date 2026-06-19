/**
 * Bitbucket authentication wrapper — app-password / Basic auth for the
 * Bitbucket Cloud API.
 *
 * Wraps the username + app password configured via environment variables
 * so the rest of the platform layer does not need to know about config keys.
 */

import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-bitbucket-auth' });

export interface BitbucketAuth {
  /** The Bitbucket API base URL. */
  readonly baseUrl: string;

  /** The username (BITBUCKET_USERNAME). */
  readonly username: string;

  /** The app password (BITBUCKET_APP_PASSWORD). */
  readonly appPassword: string;

  /** Return a Basic Authorization header value. */
  basicAuthHeader(): string;

  /** Check whether auth is configured and available. */
  isConfigured(): boolean;
}

let _auth: BitbucketAuth | undefined;

function createAuth(): BitbucketAuth {
  const baseUrl = 'https://api.bitbucket.org/2.0';
  const { username, appPassword } = config.bitbucket;

  if (!username || !appPassword) {
    log.warn('Bitbucket credentials not configured — set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD');
  }

  return {
    baseUrl,
    username,
    appPassword,
    basicAuthHeader() {
      const encoded = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
      return `Basic ${encoded}`;
    },
    isConfigured() {
      return Boolean(this.username && this.appPassword);
    },
  };
}

/**
 * Get the shared BitbucketAuth instance (lazily initialised).
 */
export function getBitbucketAuth(): BitbucketAuth {
  if (!_auth) {
    _auth = createAuth();
  }
  return _auth;
}

/**
 * Reset the cached auth (useful in tests).
 */
export function resetBitbucketAuth(): void {
  _auth = undefined;
}
