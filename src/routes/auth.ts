import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'auth-routes' });

// ---------------------------------------------------------------------------
// Rate Limiting: 20 requests per minute for unauthenticated OAuth endpoints
// ---------------------------------------------------------------------------

const authLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
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

router.get('/github', (_req: Request, res: Response) => {
  const state = crypto.randomUUID();
  const redirectUri = `http://localhost:3000/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: config.github.oauthClientId ?? '',
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
        client_id: config.github.oauthClientId ?? '',
        client_secret: config.github.oauthClientSecret ?? '',
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
