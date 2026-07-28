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

const log = rootLogger.child({ module: 'github-oauth' });
const router: Router = Router();
const callbackSchema = z.object({ code: z.string().min(1) });

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

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const t = await gitHubOAuthRepository.findByUserId(req.user!.id);
    if (!t) { res.status(404).json({ error: 'No GitHub OAuth token found' }); return; }
    res.json({ id: t.id, githubLogin: t.githubLogin, githubUserId: t.githubUserId, avatarUrl: t.avatarUrl, scope: t.scope, tokenExpiresAt: t.tokenExpiresAt, createdAt: t.createdAt });
  } catch (err) { log.error({ err: String(err) }, 'Failed'); res.status(500).json({ error: 'Failed' }); }
});

router.delete('/me', requireAuth, async (req: Request, res: Response) => {
  try { await gitHubOAuthRepository.delete(req.user!.id); res.json({ success: true }); }
  catch (err) { log.error({ err: String(err) }, 'Failed'); res.status(500).json({ error: 'Failed' }); }
});

export { router as gitHubOAuthRouter };
