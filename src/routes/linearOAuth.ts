import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { authService } from '../auth/service.js';
import { requireAuth } from '../auth/middleware.js';
import { getSupabaseAdmin } from '../auth/supabase.js';
import { linearOAuthRepository } from '../db/repositories/LinearOAuthRepository.js';
import { encrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';
import { auditLog } from '../audit/middleware.js';

const log = rootLogger.child({ module: 'linear-oauth' });
const router: Router = Router();
const callbackSchema = z.object({ code: z.string().min(1) });

function clientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.LINEAR_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.LINEAR_OAUTH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// POST /url — Generate Linear OAuth authorization URL
router.post('/url', async (_req: Request, res: Response) => {
  try {
    const client = clientConfig();
    if (!client) {
      res.status(501).json({ error: 'Linear OAuth not configured — set LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET' });
      return;
    }
    const baseUrl = process.env.STAS_PUBLIC_URL || `http://localhost:${config.port}`;
    const redirectUri = `${baseUrl}/api/v1/auth/linear/callback`;
    const url = `https://linear.app/oauth/authorize?client_id=${client.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read&state=${crypto.randomUUID()}`;
    res.json({ url });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to generate Linear OAuth URL');
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// GET /callback — Handle Linear OAuth redirect (Linear GET redirect to frontend)
router.get('/callback', (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (code) {
    const frontendUrl = process.env.STAS_PUBLIC_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/repos?provider=linear&code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`);
  } else {
    res.status(400).json({ error: 'Missing authorization code' });
  }
});

// POST /token — Receive and store a Linear provider token (from frontend OAuth)
router.post('/token', requireAuth, async (req: Request, res: Response) => {
  try {
    const { providerToken, refreshToken } = req.body;
    if (!providerToken) {
      res.status(400).json({ error: 'providerToken required' });
      return;
    }

    const me = await fetchLinearViewer(providerToken);
    await linearOAuthRepository.upsert({
      userId: req.user!.id,
      accessTokenEncrypted: encrypt(providerToken),
      refreshTokenEncrypted: refreshToken ? encrypt(refreshToken) : null,
      linearUserId: me?.id ? String(me.id) : null,
      linearUserName: me?.name ?? null,
      linearUserEmail: me?.email ?? null,
      scope: 'read',
    });

    res.json({ success: true, linearUser: me });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to store Linear token');
    res.status(500).json({ error: 'Failed to store Linear token' });
  }
});

// POST /callback — Handle Linear OAuth code exchange (backend flow)
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const parsed = callbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const client = clientConfig();
    if (!client) {
      res.status(501).json({ error: 'Linear OAuth not configured' });
      return;
    }

    const baseUrl = process.env.STAS_PUBLIC_URL || `http://localhost:${config.port}`;
    const redirectUri = `${baseUrl}/api/v1/auth/linear/callback`;
    const tokenRes = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: parsed.data.code,
        redirect_uri: redirectUri,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      log.error({ status: tokenRes.status }, 'Linear OAuth token exchange failed');
      res.status(502).json({ error: 'Linear OAuth token exchange failed' });
      return;
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error?: string };
    if (tokenData.error || !tokenData.access_token) {
      res.status(400).json({ error: tokenData.error || 'Missing access_token' });
      return;
    }

    const me = await fetchLinearViewer(tokenData.access_token);
    const userEmail = me?.email || null;

    let userId: string;
    let userEmailValue: string;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const p = authService.verifyToken(authHeader.slice(7));
        userId = p.sub;
        userEmailValue = p.email;
      } catch {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
    } else if (me?.id) {
      const existing = await linearOAuthRepository.findByLinearUserId(String(me.id));
      if (existing) {
        userId = existing.userId;
        userEmailValue = existing.linearUserEmail || `${me.id}@linear.user`;
      } else {
        const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
          email: userEmail || `${me.id}@linear.user`,
          password: crypto.randomUUID(),
          user_metadata: { name: me?.name || 'Linear User' },
        });
        if (error) {
          res.status(500).json({ error: 'Failed to create user' });
          return;
        }
        userId = data.user.id;
        userEmailValue = data.user.email!;
      }
    } else {
      res.status(400).json({ error: 'Could not resolve Linear user' });
      return;
    }

    await linearOAuthRepository.upsert({
      userId,
      accessTokenEncrypted: encrypt(tokenData.access_token),
      refreshTokenEncrypted: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
      linearUserId: me?.id ? String(me.id) : null,
      linearUserName: me?.name ?? null,
      linearUserEmail: me?.email ?? null,
      scope: 'read',
    });

    const ar = authService.generateTokens(userId, userEmailValue);
    res.json({ ...ar, linear: me });
  } catch (err) {
    log.error({ err: String(err) }, 'Linear OAuth callback failed');
    res.status(500).json({ error: 'Linear OAuth callback failed' });
  }
});

// GET /status — Check Linear connection status
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await linearOAuthRepository.findByUserId(req.user!.id);
    if (!token) {
      res.json({ connected: false });
      return;
    }
    res.json({ connected: true, linearUser: token.linearUserName, linearUserEmail: token.linearUserEmail });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to check Linear status');
    res.json({ connected: false });
  }
});

// GET /profile — Get Linear OAuth profile
router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await linearOAuthRepository.findByUserId(req.user!.id);
    if (!token) {
      res.status(404).json({ error: 'No Linear OAuth token found' });
      return;
    }
    res.json({
      id: token.id,
      linearUserId: token.linearUserId,
      linearUserName: token.linearUserName,
      linearUserEmail: token.linearUserEmail,
      scope: token.scope,
      createdAt: token.createdAt,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch Linear profile');
    res.status(500).json({ error: 'Failed' });
  }
});

// DELETE /disconnect — Disconnect Linear account
router.delete('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    await linearOAuthRepository.delete(req.user!.id);
    auditLog({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'settings.linear.disconnect',
      resourceType: 'linear_oauth',
      resourceId: req.user!.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to disconnect Linear');
    res.status(500).json({ error: 'Failed' });
  }
});

async function fetchLinearViewer(accessToken: string): Promise<{ id: string | number; name?: string; email?: string } | null> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: '{ viewer { id name email } }' }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { viewer?: { id: string; name?: string; email?: string } } };
  return json.data?.viewer ?? null;
}

export { router as linearOAuthRouter };
