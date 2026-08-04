/**
 * OAuth login via Supabase Auth — Google + Microsoft Entra (azure) + GitHub.
 *
 * Server-side PKCE flow:
 *   GET /api/v1/auth/oauth/:provider/start    -> 302 to Supabase authorize URL
 *   GET /api/v1/auth/oauth/:provider/callback -> exchange code, upsert user, issue SYNTARO tokens
 *
 * The authorize URL is built by supabase-js signInWithOAuth so GoTrue registers
 * the PKCE flow state correctly (hand-built URLs get "OAuth state not found").
 * The PKCE verifier is kept in an httpOnly cookie via a storage adapter so the
 * flow survives the browser round-trip (Node has no localStorage).
 */

import { createClient } from '@supabase/supabase-js';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit/middleware.js';
import { config } from '../config.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { authService } from './service.js';

const log = rootLogger.child({ module: 'oauth' });
const router: Router = Router();

const OAUTH_PROVIDERS = ['google', 'azure', 'github'] as const;
const providerSchema = z.enum(OAUTH_PROVIDERS);
const callbackSchema = z.object({
  code: z.string().min(1),
});

const VERIFIER_COOKIE_PREFIX = 'syntaro_oauth_pkce_';
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function cookieBase(): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

function readCookies(req: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || !value) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function cookieStorage(req: Request, res: Response) {
  const cookies = readCookies(req);
  const base = cookieBase();
  return {
    getItem(key: string): string | null {
      return cookies.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (!key.includes('code-verifier')) return;
      res.cookie(key, value, { ...base, maxAge: COOKIE_MAX_AGE_MS });
    },
    removeItem(key: string): void {
      res.clearCookie(key, base);
    },
  };
}

function clearVerifierCookies(req: Request, res: Response): void {
  for (const name of readCookies(req).keys()) {
    if (name.startsWith(VERIFIER_COOKIE_PREFIX) || name.includes('code-verifier')) {
      res.clearCookie(name, cookieBase());
    }
  }
}

function oauthClient(req: Request, res: Response) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    auth: {
      flowType: 'pkce',
      storage: cookieStorage(req, res),
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

function dashboardUrl(): string {
  return config.saml.dashboardUrl || 'http://localhost:5173';
}

function callbackUrl(provider: string): string {
  const baseUrl = process.env.SYNTARO_PUBLIC_URL || `http://localhost:${config.port}`;
  return `${baseUrl}/api/v1/auth/oauth/${provider}/callback`;
}

function loginRedirect(res: Response, error?: string): void {
  const url = error ? `${dashboardUrl()}/login?error=${encodeURIComponent(error)}` : dashboardUrl();
  res.redirect(302, url);
}

// GET /:provider/start — redirect the browser to the provider's authorize URL
router.get('/:provider/start', async (req: Request, res: Response) => {
  const parsed = providerSchema.safeParse(req.params.provider);
  if (!parsed.success) {
    res.status(400).json({ error: `Unsupported OAuth provider: ${req.params.provider}` });
    return;
  }

  try {
    if (!config.supabase.url || !config.supabase.anonKey) {
      res.status(501).json({ error: 'OAuth not configured - set SUPABASE_URL and SUPABASE_ANON_KEY' });
      return;
    }

    const supabase = oauthClient(req, res);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: parsed.data,
      options: {
        redirectTo: callbackUrl(parsed.data),
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      log.error({ provider: parsed.data, err: error?.message ?? 'no url' }, 'Failed to build OAuth authorize URL');
      res.status(500).json({ error: 'Failed to start OAuth flow' });
      return;
    }

    try {
      auditLog({
        actorType: 'system',
        action: 'auth.oauth.start',
        resourceType: 'account',
        details: { provider: parsed.data },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: req.requestId,
      });
    } catch (auditErr) {
      log.error({ err: String(auditErr) }, 'Failed to audit OAuth start');
    }

    log.info({ provider: parsed.data }, 'OAuth start - redirecting to provider');
    res.redirect(302, data.url);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to start OAuth flow');
    res.status(500).json({ error: 'Failed to start OAuth flow' });
  }
});

// GET /:provider/callback — exchange the code, upsert the user, issue tokens
router.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = providerSchema.safeParse(req.params.provider);
  const query = callbackSchema.safeParse(req.query);
  if (!provider.success || !query.success) {
    loginRedirect(res, 'invalid_oauth_callback');
    return;
  }

  try {
    if (!config.supabase.url || !config.supabase.anonKey) {
      loginRedirect(res, 'oauth_not_configured');
      return;
    }

    const supabase = oauthClient(req, res);
    const { data, error } = await supabase.auth.exchangeCodeForSession(query.data.code);
    if (error || !data.user || !data.user.email) {
      log.warn({ provider: provider.data, err: error?.message ?? 'no user' }, 'OAuth code exchange failed');
      loginRedirect(res, 'oauth_exchange_failed');
      return;
    }

    const user = data.user;
    const name = user.user_metadata?.name ?? null;

    try {
      await queryWithRetry(
        `INSERT INTO users (id, email, name, password_hash, plan, role, subscription_status, created_at, updated_at)
         VALUES ($1, $2, $3, 'oauth', 'free', 'user', 'active', NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()`,
        [user.id, user.email, name ?? user.email],
      );
    } catch (dbErr) {
      log.error({ err: String(dbErr) }, 'Failed to upsert user record - non-fatal');
    }

    const role = (user.app_metadata?.role as string | undefined) ?? 'user';
    const result = authService.generateTokens(user.id, user.email!, name, role);

    try {
      auditLog({
        actorType: 'user',
        actorId: user.id,
        action: 'auth.oauth_callback',
        resourceType: 'account',
        resourceId: user.id,
        details: { provider: provider.data, email: user.email },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: req.requestId,
      });
    } catch (auditErr) {
      log.error({ err: String(auditErr) }, 'Failed to audit OAuth callback');
    }

    clearVerifierCookies(req, res);
    log.info({ provider: provider.data, userId: user.id }, 'OAuth login succeeded');
    res.redirect(
      302,
      `${dashboardUrl()}/login?token=${encodeURIComponent(result.token)}&refreshToken=${encodeURIComponent(result.refreshToken)}`,
    );
  } catch (err) {
    log.error({ err: String(err) }, 'OAuth callback failed');
    loginRedirect(res, 'oauth_failed');
  }
});

export const oauthRouter = router;
