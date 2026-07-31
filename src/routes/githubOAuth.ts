import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { authService } from '../auth/service.js';
import { requireAuth } from '../auth/middleware.js';
import { getSupabaseAdmin } from '../auth/supabase.js';
import { gitHubOAuthRepository } from '../db/repositories/GitHubOAuthRepository.js';
import { encrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';
import { auditLog } from '../audit/middleware.js';

const log = rootLogger.child({ module: 'github-oauth' });
const router: Router = Router();
const callbackSchema = z.object({ code: z.string().min(1) });

// POST /url — Generate GitHub OAuth authorization URL
router.post('/url', async (_req: Request, res: Response) => {
  try {
    const clientId = config.github.oauthClientId;
    if (!clientId) {
      // Dev mode: use configured DEV_GITHUB_TOKEN directly
      if (config.github.devToken) {
        res.json({ url: '', devMode: true, message: 'Using DEV_GITHUB_TOKEN' });
        return;
      }
      res.status(501).json({ error: 'GitHub OAuth not configured — set GITHUB_OAUTH_CLIENT_ID' });
      return;
    }
    const baseUrl = process.env.STAS_PUBLIC_URL || `http://localhost:${config.port}`;
    const redirectUri = `${baseUrl}/api/v1/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user&state=${crypto.randomUUID()}`;
    res.json({ url });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to generate GitHub OAuth URL');
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// GET /callback — Handle GitHub OAuth callback (GitHub GET redirect)
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (code) {
    const frontendUrl = process.env.STAS_PUBLIC_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/repos?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`);
  } else {
    res.status(400).json({ error: 'Missing authorization code' });
  }
});

// POST /token — Receive and store a GitHub provider token from Supabase OAuth
router.post('/token', requireAuth, async (req: Request, res: Response) => {
  try {
    const { providerToken } = req.body;
    if (!providerToken) { res.status(400).json({ error: 'providerToken required' }); return; }

    // Fetch GitHub user info
    const ur = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + providerToken, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot' }
    });
    if (!ur.ok) { res.status(502).json({ error: 'Failed to fetch GitHub user' }); return; }
    const gu = await ur.json();

    // Store the token
    await gitHubOAuthRepository.upsert({
      userId: req.user!.id,
      accessTokenEncrypted: encrypt(providerToken),
      githubLogin: gu.login,
      githubUserId: gu.id,
      scope: 'repo,user',
    });

    res.json({ success: true, githubLogin: gu.login, githubUserId: gu.id });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to store GitHub token');
    res.status(500).json({ error: 'Failed to store GitHub token' });
  }
});

// POST /callback — Handle GitHub OAuth callback
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const parsed = callbackSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
    const tr = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'stas-bot' }, body: JSON.stringify({ client_id: config.github.oauthClientId, client_secret: config.github.oauthClientSecret, code: parsed.data.code }) });
    if (!tr.ok) { log.error({ status: tr.status }, 'GitHub OAuth token exchange failed'); res.status(502).json({ error: 'GitHub OAuth token exchange failed' }); return; }
    const td = await tr.json();
    if (td.error) { log.error({ error: td.error }, 'GitHub OAuth error'); res.status(400).json({ error: td.error_description || td.error }); return; }
    const ur = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + td.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'stas-bot' } });
    if (!ur.ok) { res.status(502).json({ error: 'Failed to fetch GitHub user' }); return; }
    const gu = await ur.json();
    let userId, userEmail, authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try { const p = authService.verifyToken(authHeader.slice(7)); userId = p.sub; userEmail = p.email; }
      catch { res.status(401).json({ error: 'Invalid token' }); return; }
    } else {
      const et = await gitHubOAuthRepository.findByGithubUserId(gu.id);
      if (et) {
        const ue = gu.email || gu.login + '@github.user';
        userId = et.userId; userEmail = ue;
      } else {
        const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
          email: gu.email || gu.login + '@github.user',
          password: crypto.randomUUID(),
          user_metadata: { name: gu.name || gu.login },
        });
        if (error) { res.status(500).json({ error: 'Failed to create user' }); return; }
        userId = data.user.id; userEmail = data.user.email!;
      }
    }
    await gitHubOAuthRepository.upsert({ userId: userId, accessTokenEncrypted: encrypt(td.access_token), githubLogin: gu.login, githubUserId: gu.id, scope: td.scope || '' });
    const ar = authService.generateTokens(userId, userEmail);
    res.json({ ...ar, github: { login: gu.login, id: gu.id, avatarUrl: gu.avatar_url } });
  } catch (err) { log.error({ err: String(err) }, 'GitHub OAuth callback failed'); res.status(500).json({ error: 'GitHub OAuth callback failed' }); }
});

// GET /status — Check GitHub connection status for authenticated user
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const t = await gitHubOAuthRepository.findByUserId(req.user!.id);
    if (!t) {
      if (config.github.devToken) {
        res.json({ connected: true, githubLogin: 'dev-user', devMode: true });
        return;
      }
      res.json({ connected: false });
      return;
    }
    res.json({ connected: true, githubLogin: (t as any).github_login ?? t.githubLogin, githubUserId: (t as any).github_user_id ?? t.githubUserId });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to check GitHub status');
    if (config.github.devToken) {
      res.json({ connected: true, githubLogin: 'dev-user', devMode: true });
      return;
    }
    res.json({ connected: false });
  }
});

// GET /profile — Get GitHub OAuth profile for authenticated user
router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const t = await gitHubOAuthRepository.findByUserId(req.user!.id);
    if (!t) { res.status(404).json({ error: 'No GitHub OAuth token found' }); return; }
    res.json({ id: t.id, githubLogin: t.githubLogin, githubUserId: t.githubUserId, avatarUrl: t.avatarUrl, scope: t.scope, tokenExpiresAt: t.tokenExpiresAt, createdAt: t.createdAt });
  } catch (err) { log.error({ err: String(err) }, 'Failed'); res.status(500).json({ error: 'Failed' }); }
});

// DELETE /disconnect — Disconnect GitHub account
router.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await gitHubOAuthRepository.delete(req.user!.id);
    auditLog({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'settings.github.disconnect',
      resourceType: 'github_oauth',
      resourceId: req.user!.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json({ success: true });
  } catch (err) { log.error({ err: String(err) }, 'Failed'); res.status(500).json({ error: 'Failed' }); }
});

export { router as gitHubOAuthRouter };
