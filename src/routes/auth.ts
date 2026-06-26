/**
 * GitHub OAuth authentication routes.
 *
 * Flow:
 *   GET  /api/auth/github     — redirects to GitHub OAuth authorization page
 *   GET  /api/auth/callback   — handles the OAuth callback, exchanges code
 *                                for a token, fetches user info, creates a
 *                                session JWT, redirects to the dashboard
 *   GET  /api/auth/me         — returns the current user (requires session)
 *   POST /api/auth/logout     — clears the session
 *
 * All unauthenticated endpoints are rate-limited to 20 req/min.
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { requireSession, createSessionToken } from '../middleware/auth.js';

const log = rootLogger.child({ module: 'auth-routes' });

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

const router = Router();
router.use(authLimiter);

const STATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  maxAge: 600_000,
  path: '/',
};

const TOKEN_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  maxAge: 86_400_000,
  path: '/',
};

router.get('/github', (_req: Request, res: Response) => {
  const state = crypto.randomUUID();
  const clientId = config.github.oauthClientId;

  if (!clientId) {
    res.status(500).json({ error: 'GitHub OAuth not configured (GITHUB_OAUTH_CLIENT_ID missing)' });
    return;
  }

  const redirectUri = `${config.security.corsOrigin === '*' ? 'http://localhost:3000' : config.security.corsOrigin.split(',')[0]?.trim() || 'http://localhost:3000'}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email repo',
    state,
  });

  res.cookie('oauth_state', state, STATE_COOKIE_OPTS);
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  const storedState = parseCookies(req)?.oauth_state;
  if (!state || !storedState || state !== storedState) {
    res.status(401).json({ error: 'Invalid state parameter' });
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  const clientId = config.github.oauthClientId;
  const clientSecret = config.github.oauthClientSecret;

  if (!clientId || !clientSecret) {
    log.error('GitHub OAuth not configured');
    res.status(500).json({ error: 'OAuth not configured' });
    return;
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      log.warn({ error: tokenData.error, description: tokenData.error_description }, 'OAuth token exchange failed');
      res.status(400).json({ error: 'Failed to get access token', detail: tokenData.error_description ?? tokenData.error });
      return;
    }

    const accessToken = tokenData.access_token;

    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });

    if (!userResponse.ok) {
      log.warn({ status: userResponse.status }, 'Failed to fetch GitHub user');
      res.status(502).json({ error: 'Failed to fetch GitHub user profile' });
      return;
    }

    const ghUser = (await userResponse.json()) as {
      id: number;
      login: string;
      avatar_url: string | null;
    };

    const sessionToken = createSessionToken({
      sub: ghUser.id,
      login: ghUser.login,
      avatarUrl: ghUser.avatar_url,
    });

    res.clearCookie('oauth_state', { path: '/' });
    res.cookie('stas_token', sessionToken, TOKEN_COOKIE_OPTS);

    const accept = req.headers.accept ?? '';
    if (accept.includes('application/json')) {
      res.json({
        token: sessionToken,
        user: { githubId: String(ghUser.id), username: ghUser.login, avatarUrl: ghUser.avatar_url },
      });
    } else {
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
      res.redirect(`${dashboardUrl}/login?token=${sessionToken}`);
    }
  } catch (err) {
    log.error({ err: String(err) }, 'OAuth callback failed');
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

router.get('/me', requireSession, (req: Request, res: Response) => {
  res.json({
    user: {
      githubId: String(req.sessionUser!.id),
      username: req.sessionUser!.login,
      avatarUrl: req.sessionUser!.avatarUrl,
    },
  });
});

router.get('/dev-login', (_req: Request, res: Response) => {
  if (config.nodeEnv !== 'development') {
    res.status(403).json({ error: 'Dev login only available in development mode' });
    return;
  }

  const sessionToken = createSessionToken({
    sub: 12345678,
    login: 'dev-user',
    avatarUrl: null,
  });

  const accept = _req.headers.accept ?? '';
  if (accept.includes('application/json')) {
    res.json({
      token: sessionToken,
      user: { githubId: '12345678', username: 'dev-user', avatarUrl: null },
    });
  } else {
    res.cookie('stas_token', sessionToken, TOKEN_COOKIE_OPTS);
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
    res.redirect(`${dashboardUrl}/login?token=${sessionToken}`);
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('stas_token', { path: '/' });
  res.clearCookie('oauth_state', { path: '/' });
  res.json({ success: true });
});

function parseCookies(req: Request): Record<string, string> | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}

export { router as authRouter };
