/**
 * Bitbucket OAuth2 client-credentials grant (AIM-4630 Marketplace app).
 *
 * Mirrors the OpenSymphony contract (AIM-4633, `SymphonyElixir.Bitbucket.OAuth`):
 * the SYNTARO Bitbucket integration is a real Bitbucket Marketplace app, and
 * every outbound API call needs a workspace/repo access token obtained with the
 * OAuth2 **client-credentials** grant:
 *
 *     POST https://bitbucket.org/site/oauth2/access_token
 *     Authorization: Basic base64("<client_id>:<client_secret>")
 *     grant_type=client_credentials
 *
 * Tokens are fetched on demand and are NOT persisted.
 */

import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'platform-bitbucket-oauth' });

export interface BitbucketToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface FetchTokenOptions {
  /** Override the token endpoint (defaults to the Bitbucket Cloud URL). */
  tokenUrl?: string;
  /** Timeout for the token request in ms. */
  timeoutMs?: number;
}

/**
 * Fetch a workspace/repo access token via the client-credentials grant.
 *
 * @throws when credentials are missing or the token request fails.
 */
export async function fetchBitbucketToken(
  clientId: string,
  clientSecret: string,
  options: FetchTokenOptions = {},
): Promise<BitbucketToken> {
  if (!clientId || !clientSecret) {
    throw new Error('Bitbucket OAuth client credentials not configured — set BITBUCKET_CLIENT_ID and BITBUCKET_CLIENT_SECRET');
  }

  const tokenUrl = options.tokenUrl ?? 'https://bitbucket.org/site/oauth2/access_token';
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const timeoutMs = options.timeoutMs ?? 10_000;

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.warn({ status: res.status }, `Bitbucket token request returned HTTP ${res.status}${text ? `: ${text}` : ''}`);
      throw new Error(`Bitbucket token request failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as Partial<BitbucketToken>;
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new Error('Bitbucket token response missing access_token');
    }

    return {
      access_token: body.access_token,
      expires_in: typeof body.expires_in === 'number' ? body.expires_in : 3_600,
      token_type: typeof body.token_type === 'string' ? body.token_type : 'bearer',
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Bitbucket token request failed')) {
      throw err;
    }
    log.warn({ err: String(err) }, 'Bitbucket token fetch threw');
    throw new Error(`Bitbucket token fetch failed: ${String(err)}`);
  }
}
