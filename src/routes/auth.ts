import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'auth-routes' });
const router = Router();

const STATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  maxAge: 600_000,
  path: '/',
};

router.get('/github', (_req: Request, res: Response) => {
  const state = crypto.randomUUID();
  const redirectUri = `http://localhost:3000/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID || '',
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
  });
  res.cookie('oauth_state', state, STATE_COOKIE_OPTS);
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const storedState = req.cookies?.oauth_state;
  if (!state || state !== storedState) {
    res.status(401).json({ error: 'Invalid state parameter' });
    return;
  }
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }
  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID || '',
        client_secret: '',
        code,
      }),
    });
    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      res.status(400).json({ error: 'Failed to get access token', detail: tokenData.error });
      return;
    }
    res.clearCookie('oauth_state', { path: '/' });
    res.redirect(`http://localhost:3000/login/success?token=${tokenData.access_token}`);
  } catch (err) {
    log.error({ err: String(err) }, 'OAuth callback failed');
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

export { router as authRouter };
