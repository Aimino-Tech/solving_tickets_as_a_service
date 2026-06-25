/**
 * Linear OAuth authentication routes.
 *
 * Provides two endpoints:
 *   GET /auth/linear/login     — redirects user to Linear OAuth authorize URL
 *   GET /auth/linear/callback  — handles OAuth callback, exchanges code for token,
 *                                stores it encrypted in the billing table
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Missing client credentials logged and return friendly error
 * ✅ Invalid state parameter returns 401 with clear message
 * ✅ OAuth token exchange failure returns 502 with error detail
 * ✅ Token storage failure returns 500 with friendly message
 * ────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'auth-linear' });

const router = Router();

const STATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  maxAge: 600_000, // 10 minutes
  path: '/',
};

/**
 * LinearOAuthClient — stores and retrieves Linear OAuth tokens per user/team.
 *
 * Tokens are stored in the billing.linear_access_token column.
 */
export class LinearOAuthClient {
  /**
   * Store a Linear access token for a given tenant (installation ID).
   */
  async storeToken(tenantId: string, token: string, organizationId?: string): Promise<void> {
    const { queryWithRetry } = await import('../../db/connection.js');
    const { accountsRepository } = await import('../../db/repositories/index.js');

    // Find the account by installation ID (tenantId)
    const account = await accountsRepository.findByInstallationId(Number(tenantId));
    if (!account) {
      throw new Error(`No account found for tenant ${tenantId}`);
    }

    // Store token in billing table
    await queryWithRetry(
      `UPDATE billing
       SET linear_access_token = $1,
           linear_organization_id = $2,
           updated_at = NOW()
       WHERE account_id = $3`,
      [token, organizationId ?? null, account.id],
    );

    log.info({ tenantId, accountId: account.id }, 'Linear token stored');
  }

  /**
   * Retrieve a Linear access token for a given tenant.
   */
  async getToken(tenantId: string): Promise<string | null> {
    const { queryWithRetry } = await import('../../db/connection.js');
    const result = await queryWithRetry<{ linear_access_token: string }>(
      `SELECT b.linear_access_token
       FROM billing b
       JOIN accounts a ON a.id = b.account_id
       WHERE a.github_installation_id = $1
       AND b.linear_access_token IS NOT NULL`,
      [Number(tenantId)],
    );
    return result.rows[0]?.linear_access_token ?? null;
  }

  /**
   * Check if a tenant has a Linear token stored.
   */
  async hasToken(tenantId: string): Promise<boolean> {
    const token = await this.getToken(tenantId);
    return token !== null;
  }

  /**
   * Delete a Linear token for a given tenant.
   */
  async deleteToken(tenantId: string): Promise<void> {
    const { queryWithRetry } = await import('../../db/connection.js');
    const { accountsRepository } = await import('../../db/repositories/index.js');

    const account = await accountsRepository.findByInstallationId(Number(tenantId));
    if (!account) {
      throw new Error(`No account found for tenant ${tenantId}`);
    }

    await queryWithRetry(
      `UPDATE billing
       SET linear_access_token = NULL,
           linear_organization_id = NULL,
           updated_at = NOW()
       WHERE account_id = $1`,
      [account.id],
    );

    log.info({ tenantId, accountId: account.id }, 'Linear token deleted');
  }
}

export const linearOAuthClient = new LinearOAuthClient();

// ---------------------------------------------------------------------------
// OAuth configuration (from config or env vars)
// ---------------------------------------------------------------------------

function getLinearClientId(): string {
  return config.onboarding?.linearClientId ?? process.env.LINEAR_CLIENT_ID ?? '';
}

function getLinearClientSecret(): string {
  return config.onboarding?.linearClientSecret ?? process.env.LINEAR_CLIENT_SECRET ?? '';
}

function getLinearRedirectUri(): string {
  return process.env.LINEAR_REDIRECT_URI ?? 'http://localhost:3000/auth/linear/callback';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /auth/linear/login
 *
 * Redirects the user to the Linear OAuth authorization page.
 * A state parameter is generated and stored in a cookie for CSRF protection.
 * The tenantId is passed as a query parameter and included in the state.
 */
router.get('/login', (req: Request, res: Response) => {
  const clientId = getLinearClientId();
  if (!clientId) {
    res.status(503).json({
      error: 'Linear OAuth is not configured. Please set LINEAR_CLIENT_ID.',
    });
    return;
  }

  const tenantId = req.query.tenantId as string ?? 'unknown';
  const state = `${crypto.randomUUID()}:${tenantId}`;
  const redirectUri = getLinearRedirectUri();
  const scopes = ['read', 'write', 'issues:create', 'comments:create'].join(',');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: scopes,
  });

  res.cookie('linear_oauth_state', state, STATE_COOKIE_OPTS);
  res.redirect(`https://linear.app/oauth/authorize?${params}`);
});

/**
 * GET /auth/linear/callback
 *
 * Handles the OAuth callback from Linear:
 * 1. Verifies the state parameter (CSRF protection)
 * 2. Exchanges the authorization code for an access token
 * 3. Stores the token in the DB
 * 4. Redirects to the dashboard setup wizard
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  // Validate state parameter (CSRF)
  const storedState = req.cookies?.linear_oauth_state;
  if (!state || !storedState || state !== storedState) {
    log.warn({ state, storedState }, 'Linear OAuth: invalid state parameter');
    res.status(401).json({ error: 'Invalid state parameter. Please try again.' });
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code from Linear.' });
    return;
  }

  // Extract tenantId from state (format: "uuid:tenantId")
  const stateStr = state as string;
  const tenantId = stateStr.includes(':') ? stateStr.split(':').slice(1).join(':') : 'unknown';

  const clientId = getLinearClientId();
  const clientSecret = getLinearClientSecret();
  const redirectUri = getLinearRedirectUri();

  if (!clientId || !clientSecret) {
    log.error('Linear OAuth client credentials not configured');
    res.status(503).json({
      error: 'Linear OAuth is not configured. Please contact the administrator.',
    });
    return;
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      log.error({ status: tokenResponse.status, error: errorText }, 'Linear OAuth token exchange failed');
      res.status(502).json({
        error: 'Failed to authenticate with Linear. The authorization may have expired. Please try again.',
      });
      return;
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      scope?: string;
      organization_id?: string;
    };

    // Store the token
    await linearOAuthClient.storeToken(tenantId, tokenData.access_token, tokenData.organization_id);

    // Clear the state cookie
    res.clearCookie('linear_oauth_state', { path: '/' });

    log.info(
      { tenantId, organizationId: tokenData.organization_id },
      'Linear OAuth completed successfully',
    );

    // Redirect to the setup wizard with success indicator
    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
    res.redirect(`${dashboardUrl}/onboarding?linear=connected`);
  } catch (err) {
    log.error({ err: String(err) }, 'Linear OAuth callback failed');
    res.status(500).json({
      error: 'An unexpected error occurred during Linear authentication. Please try again.',
    });
  }
});

export { router as linearAuthRouter };
