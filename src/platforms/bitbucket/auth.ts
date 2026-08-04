/**
 * Bitbucket authentication wrapper — Marketplace-app OAuth2 credentials
 * (client-credentials grant, AIM-4630/4633).
 *
 * Wraps the Bitbucket Marketplace app client id/secret configured via
 * environment variables so the rest of the platform layer does not need to
 * know about config keys. Tokens are fetched on demand and never persisted.
 */

import { config } from '../../config.js';
import { fetchBitbucketToken } from './oauth.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-bitbucket-auth' });

export interface BitbucketAuth {
  /** The Bitbucket API base URL. */
  readonly baseUrl: string;

  /** The Marketplace app client id (BITBUCKET_CLIENT_ID). */
  readonly clientId: string;

  /** The Marketplace app client secret (BITBUCKET_CLIENT_SECRET). */
  readonly clientSecret: string;

  /** The connected workspace slug (BITBUCKET_WORKSPACE). */
  readonly workspace: string;

  /** The OAuth token endpoint. */
  readonly tokenUrl: string;

  /** Return a fresh Bearer access token via the client-credentials grant. */
  accessToken(): Promise<string>;

  /** Check whether OAuth credentials are configured. */
  isConfigured(): boolean;
}

let _auth: BitbucketAuth | undefined;

function createAuth(): BitbucketAuth {
  const baseUrl = 'https://api.bitbucket.org/2.0';
  const { clientId, clientSecret, workspace, tokenUrl } = config.bitbucket;

  if (!clientId || !clientSecret) {
    log.warn('Bitbucket OAuth credentials not configured — set BITBUCKET_CLIENT_ID and BITBUCKET_CLIENT_SECRET');
  }

  return {
    baseUrl,
    clientId,
    clientSecret,
    workspace,
    tokenUrl,
    async accessToken() {
      const token = await fetchBitbucketToken(clientId, clientSecret, { tokenUrl });
      return token.access_token;
    },
    isConfigured() {
      return Boolean(clientId && clientSecret);
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
