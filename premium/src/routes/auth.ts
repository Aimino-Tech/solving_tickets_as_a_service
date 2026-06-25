/**
 * GitHub OAuth authentication routes for the premium dashboard.
 *
 * GET  /api/auth/github      - Redirect to GitHub OAuth authorization
 * GET  /api/auth/callback    - OAuth callback: exchange code for token
 * GET  /api/auth/me          - Return current user info (requires JWT)
 * POST /api/auth/logout      - Invalidate session (placeholder)
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { rootLogger } from '../../../src/utils/logger.js';
import { jwtAuth, signJwt, invalidateToken, type JwtPayload } from '../middleware/auth.js';

const log = rootLogger.child({ module: 'premium-auth-routes' });

const router = Router();

const CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5173';

router.get('/github', (req: Request, res: Response) => {
  if (!CLIENT_ID) {
    log.error('GITHUB_CLIENT_ID not configured');
    res.status(503).json({ error: 'GitHub OAuth not configured' });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });

  const redirectUri = `${DASHBOARD_URL}/api/auth/callback`;
  const scope = 'read:user user:email';
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}`;

  log.info({ state }, 'Redirecting to GitHub OAuth');
  res.redirect(githubAuthUrl);
});

router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const storedState = req.cookies?.oauth_state;

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  if (state !== storedState) {
    log.warn({ state, storedState }, 'OAuth state mismatch - possible CSRF');
    res.status(401).json({ error: 'Invalid state parameter' });
    return;
  }

  res.clearCookie('oauth_state');

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      log.error({ error: tokenData.error, description: tokenData.error_description }, 'OAuth token exchange failed');
      res.status(401).json({ error: 'Failed to exchange authorization code' });
      return;
    }

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'stas-premium',
      },
    });

    if (!userResponse.ok) {
      log.error({ status: userResponse.status }, 'Failed to fetch GitHub user');
      res.status(502).json({ error: 'Failed to fetch user info from GitHub' });
      return;
    }

    const userData = (await userResponse.json()) as {
      id: number;
      login: string;
      avatar_url?: string;
    };

    const jwtPayload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'> = {
      sub: String(userData.id),
      username: userData.login,
      avatar_url: userData.avatar_url,
    };

    const token = signJwt(jwtPayload);

    log.info({ username: userData.login }, 'User authenticated via GitHub OAuth');

    res.redirect(`${DASHBOARD_URL}/auth/callback?token=${token}`);
  } catch (err) {
    log.error({ err: String(err) }, 'OAuth callback error');
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

router.get('/me', jwtAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

router.post('/logout', jwtAuth, (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    invalidateToken(token);
  }

  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  log.info({ username: req.user?.username }, 'User logged out');
  res.json({ success: true, message: 'Session terminated' });
});

export { router as authRouter };
