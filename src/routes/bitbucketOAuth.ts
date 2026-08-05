/**
 * Bitbucket OAuth 2.0 — dashboard "Connect with Bitbucket".
 *
 * Uses a Bitbucket OAuth client/consumer (Workspace settings → OAuth clients).
 * Access tokens are Bearer tokens — no Atlassian email required at connect time.
 *
 * Routes (mounted at /api/v1/auth/bitbucket):
 *   POST   /url         — authorization URL (requireAuth)
 *   GET    /callback    — browser redirect → /settings?bitbucket_code=
 *   POST   /callback    — exchange code, persist connection (requireAuth)
 *   GET    /status      — oauth configured + connection summary
 */

import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit/middleware.js';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { bitbucketConnectionRepository } from '../db/repositories/BitbucketConnectionRepository.js';
import { BitbucketPlatformClient } from '../platforms/bitbucket/index.js';
import { decrypt, encrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';
import type { BitbucketConnection } from '../db/types/bitbucket.js';

const log = rootLogger.child({ module: 'bitbucket-oauth' });
const router: Router = Router();

const callbackSchema = z.object({
  code: z.string().min(1),
  workspace: z.string().optional(),
});

/** Classic Bitbucket OAuth scopes (also configure these on the OAuth consumer). */
const OAUTH_SCOPES = [
  'account',
  'repository',
  'repository:write',
  'pullrequest',
  'pullrequest:write',
  'issue',
  'issue:write',
  'webhook',
].join(' ');

/**
 * Placeholder workspace when the Bitbucket account has none yet.
 * UNIQUE(workspace) still holds — one pending row per SYNTARO user.
 * Connection (tokens) is valid; workspace can be chosen later.
 */
const PENDING_WORKSPACE_PREFIX = '__pending__:';

export function pendingWorkspaceForUser(userId: string): string {
  return `${PENDING_WORKSPACE_PREFIX}${userId}`;
}

export function isPendingWorkspace(workspace: string | null | undefined): boolean {
  return !workspace || workspace.startsWith(PENDING_WORKSPACE_PREFIX);
}

/** Value shown to the dashboard — empty string while workspace is unassigned. */
export function displayWorkspace(workspace: string | null | undefined): string {
  return isPendingWorkspace(workspace) ? '' : String(workspace);
}

function publicBaseUrl(): string {
  // API / webhook / OAuth callback host (Bitbucket hits this URL)
  return process.env.SYNTARO_PUBLIC_URL || `http://localhost:${config.port}`;
}

function frontendBaseUrl(): string {
  // Browser SPA host — must NOT reuse SYNTARO_PUBLIC_URL when that points at the API
  // (e.g. http://localhost:3002), or OAuth return loses the JWT on :5173 and dumps to /login.
  return (
    process.env.SYNTARO_FRONTEND_URL ||
    process.env.DASHBOARD_URL ||
    process.env.VITE_DEV_SERVER_URL ||
    'http://localhost:5173'
  );
}

function redirectUri(): string {
  return `${publicBaseUrl()}/api/v1/auth/bitbucket/callback`;
}

function oauthConfigured(): boolean {
  return Boolean(config.bitbucket.oauthClientId && config.bitbucket.oauthClientSecret);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scopes?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(params: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(
    `${config.bitbucket.oauthClientId}:${config.bitbucket.oauthClientSecret}`,
  ).toString('base64');
  const res = await fetch('https://bitbucket.org/site/oauth2/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    const msg = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`Bitbucket token exchange failed: ${msg}`);
  }
  return json;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      // Must match the callback registered on the OAuth client and used at authorize time.
      redirect_uri: redirectUri(),
    }),
  );
}

export async function refreshBitbucketAccessToken(refreshToken: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  );
}

/** Build a platform client from stored credentials (Basic API token or Bearer OAuth). */
export function clientFromBitbucketConnection(
  username: string,
  secret: string,
  authMethod: 'api_token' | 'oauth' = 'api_token',
): BitbucketPlatformClient {
  if (authMethod === 'oauth') {
    return new BitbucketPlatformClient(`bearer:${secret}`, config.bitbucket.baseUrl);
  }
  return new BitbucketPlatformClient(`${username}:${secret}`, config.bitbucket.baseUrl);
}

/**
 * Resolve a live client from a DB row, refreshing OAuth access tokens when expired.
 */
export async function clientFromStoredConnection(
  row: BitbucketConnection,
): Promise<BitbucketPlatformClient> {
  let accessSecret = decrypt(row.appPasswordEncrypted);
  if (row.authMethod === 'oauth' && row.refreshTokenEncrypted) {
    const expired =
      row.tokenExpiresAt != null && new Date(row.tokenExpiresAt).getTime() < Date.now() + 60_000;
    if (expired && oauthConfigured()) {
      try {
        const tokens = await refreshBitbucketAccessToken(decrypt(row.refreshTokenEncrypted));
        accessSecret = tokens.access_token!;
        const expiresAt =
          typeof tokens.expires_in === 'number'
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null;
        await bitbucketConnectionRepository.upsert({
          userId: row.userId,
          username: row.username,
          appPasswordEncrypted: encrypt(accessSecret),
          workspace: row.workspace,
          authMethod: 'oauth',
          refreshTokenEncrypted: tokens.refresh_token
            ? encrypt(tokens.refresh_token)
            : row.refreshTokenEncrypted,
          bitbucketUuid: row.bitbucketUuid,
          scope: tokens.scopes ?? row.scope,
          tokenExpiresAt: expiresAt,
        });
      } catch (err) {
        log.warn({ err: String(err), userId: row.userId }, 'Bitbucket OAuth refresh failed — using stored access token');
      }
    }
  }
  return clientFromBitbucketConnection(row.username, accessSecret, row.authMethod);
}

router.post('/url', requireAuth, (_req: Request, res: Response) => {
  try {
    if (!oauthConfigured()) {
      res.status(501).json({
        error:
          'Bitbucket OAuth not configured — set BITBUCKET_OAUTH_CLIENT_ID and BITBUCKET_OAUTH_CLIENT_SECRET (Workspace → Settings → OAuth clients)',
      });
      return;
    }
    const state = randomUUID();
    const url =
      `https://bitbucket.org/site/oauth2/authorize` +
      `?client_id=${encodeURIComponent(config.bitbucket.oauthClientId)}` +
      `&response_type=code` +
      `&state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPES)}`;
    res.json({ url, redirectUri: redirectUri(), scopes: OAUTH_SCOPES });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to build Bitbucket OAuth URL');
    res.status(500).json({ error: 'Failed to build Bitbucket OAuth URL' });
  }
});

router.get('/callback', (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';
  if (error) {
    res.redirect(
      `${frontendBaseUrl()}/settings?bitbucket_oauth=error&error=${encodeURIComponent(error)}`,
    );
    return;
  }
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }
  const q = new URLSearchParams({ bitbucket_code: code });
  if (state) q.set('state', state);
  res.redirect(`${frontendBaseUrl()}/settings?${q.toString()}`);
});

router.post('/callback', requireAuth, async (req: Request, res: Response) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
    return;
  }
  if (!oauthConfigured()) {
    res.status(501).json({ error: 'Bitbucket OAuth not configured' });
    return;
  }

  const uid = String(req.user!.id);
  try {
    const tokens = await exchangeCode(parsed.data.code);
    const client = clientFromBitbucketConnection('bearer', tokens.access_token!, 'oauth');

    let username = 'bitbucket';
    let bitbucketUuid: string | null = null;
    try {
      username = await client.getAuthenticatedUser();
      const apiBase = config.bitbucket.baseUrl.includes('/2.0')
        ? config.bitbucket.baseUrl.replace(/\/$/, '')
        : `${config.bitbucket.baseUrl.replace(/\/$/, '')}/2.0`;
      const probe = await fetch(`${apiBase}/user`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      });
      if (probe.ok) {
        const gu = (await probe.json()) as { username?: string; uuid?: string };
        if (gu.username) username = gu.username;
        if (gu.uuid) bitbucketUuid = gu.uuid;
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Bitbucket OAuth /user failed — continuing with workspaces');
    }

    const workspaces = await client.listWorkspaces();
    const preferred = (parsed.data.workspace ?? '').trim();
    const resolvedSlug =
      (preferred && workspaces.some((w) => w.slug === preferred) ? preferred : workspaces[0]?.slug) ??
      '';
    // Connect account tokens even when the user has zero workspaces yet.
    const workspace = resolvedSlug || pendingWorkspaceForUser(uid);
    const workspacePending = isPendingWorkspace(workspace);

    if (!workspacePending) {
      const existing = await bitbucketConnectionRepository.findByWorkspace(workspace);
      if (existing && existing.userId !== uid) {
        res.status(409).json({ error: 'This Bitbucket workspace is already connected by another user' });
        return;
      }
    } else {
      log.info(
        { userId: uid, username, bitbucketUuid },
        'Bitbucket OAuth connected without workspace — user can create/join one on Bitbucket later',
      );
    }

    let repoCount = 0;
    if (!workspacePending) {
      const repos = await client.listRepos(workspace);
      repoCount = repos.length;
    }

    const expiresAt =
      typeof tokens.expires_in === 'number'
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

    await bitbucketConnectionRepository.upsert({
      userId: uid,
      username,
      appPasswordEncrypted: encrypt(tokens.access_token!),
      workspace,
      authMethod: 'oauth',
      refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      bitbucketUuid,
      scope: tokens.scopes ?? OAUTH_SCOPES,
      tokenExpiresAt: expiresAt,
    });

    auditLog({
      actorType: 'user',
      actorId: uid,
      action: 'settings.bitbucket.oauth.connect',
      resourceType: 'bitbucket_connection',
      resourceId: displayWorkspace(workspace) || uid,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });

    log.info(
      { workspace: displayWorkspace(workspace), workspacePending, userId: uid, username, repoCount },
      'Bitbucket OAuth connected',
    );
    res.json({
      connected: true,
      workspace: displayWorkspace(workspace),
      workspacePending,
      repoCount,
      workspaces: workspaces.map((w) => w.slug),
      username,
      authMethod: 'oauth' as const,
    });
  } catch (err) {
    log.error({ err: String(err), userId: uid }, 'Bitbucket OAuth callback failed');
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Bitbucket OAuth callback failed',
    });
  }
});

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await bitbucketConnectionRepository.findByUserId(String(req.user!.id));
    res.json({
      oauthConfigured: oauthConfigured(),
      connected: Boolean(row),
      workspace: displayWorkspace(row?.workspace),
      workspacePending: row ? isPendingWorkspace(row.workspace) : false,
      authMethod: row?.authMethod ?? null,
      username: row?.username ?? null,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Bitbucket OAuth status failed');
    res.status(500).json({ error: 'Failed to load Bitbucket OAuth status' });
  }
});

export { router as bitbucketOAuthRouter };
