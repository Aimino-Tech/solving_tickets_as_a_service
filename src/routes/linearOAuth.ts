import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit/middleware.js';
import { requireAuth } from '../auth/middleware.js';
import { authService } from '../auth/service.js';
import { getSupabaseAdmin } from '../auth/supabase.js';
import { config } from '../config.js';
import { linearOAuthRepository } from '../db/repositories/LinearOAuthRepository.js';
import { encrypt } from '../utils/encryption.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'linear-oauth' });

const router: Router = Router();

const callbackSchema = z.object({ code: z.string().min(1) });
const tokenSchema = z.object({ providerToken: z.string().min(1) });

interface LinearViewer {
  id: string;
  name?: string;
  email?: string;
}

async function fetchLinearViewer(accessToken: string): Promise<LinearViewer> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'query { viewer { id name email } }',
    }),
  });
  if (!response.ok) {
    throw new Error(`Linear GraphQL failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: { viewer?: LinearViewer } };
  const viewer = body.data?.viewer;
  if (!viewer?.id) {
    throw new Error('Linear GraphQL response missing viewer');
  }
  return viewer;
}

router.post('/url', (_req: Request, res: Response) => {
  try {
    const clientId = config.linearOauth.clientId;
    if (!clientId) {
      res.status(501).json({ error: 'Linear OAuth not configured — set LINEAR_OAUTH_CLIENT_ID' });
      return;
    }
    const baseUrl = process.env.STAS_PUBLIC_URL || `http://localhost:${config.port}`;
    const redirectUri = `${baseUrl}/api/v1/auth/linear/callback`;
    const url =
      `https://linear.app/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&response_type=code&scope=read,write,issues:write' +
      `&state=${randomUUID()}`;
    res.json({ url });
  } catch (err) {
    log.error({ err }, 'Failed to build Linear OAuth URL');
    res.status(500).json({ error: 'Failed to build Linear OAuth URL' });
  }
});

router.get('/callback', (req: Request, res: Response) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }
  const frontendUrl = process.env.STAS_PUBLIC_URL || 'http://localhost:5173';
  res.redirect(`${frontendUrl}/settings?code=${code}&state=${state ?? ''}`);
});

router.post('/token', requireAuth, async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  try {
    const viewer = await fetchLinearViewer(parsed.data.providerToken);
    await linearOAuthRepository.upsert({
      userId: req.user!.id,
      accessTokenEncrypted: encrypt(parsed.data.providerToken),
      linearUserId: viewer.id,
      linearLogin: viewer.name ?? viewer.email ?? viewer.id,
      scope: 'read,write,issues:write',
    });
    res.json({ success: true, linearLogin: viewer.name ?? viewer.email ?? viewer.id });
  } catch (err) {
    log.error({ err }, 'Failed to store Linear token');
    res.status(502).json({ error: 'Failed to reach Linear API' });
  }
});

router.post('/callback', async (req: Request, res: Response) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  try {
    const tokenResponse = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.linearOauth.clientId,
        client_secret: config.linearOauth.clientSecret,
        code: parsed.data.code,
        redirect_uri: `${process.env.STAS_PUBLIC_URL || `http://localhost:${config.port}`}/api/v1/auth/linear/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      log.warn({ status: tokenResponse.status }, 'Linear token exchange failed');
      res.status(502).json({ error: 'Linear token exchange failed' });
      return;
    }
    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!tokens.access_token) {
      res.status(400).json({ error: 'Linear token exchange returned no access token' });
      return;
    }

    const viewer = await fetchLinearViewer(tokens.access_token);

    const authHeader = req.headers.authorization;
    let userId = '';
    let userEmail = '';
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await authService.verifyToken(authHeader.slice(7));
        userId = payload.sub;
        userEmail = payload.email;
      } catch {
        userId = '';
      }
    }
    if (!userId) {
      const existing = await linearOAuthRepository.findByLinearUserId(viewer.id);
      if (existing) {
        userId = existing.userId;
      }
    }
    if (!userId) {
      const email = viewer.email ?? `${viewer.id}@linear.user`;
      const supabaseAdmin = getSupabaseAdmin();
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        password: randomUUID(),
        user_metadata: { name: viewer.name ?? viewer.id },
      });
      userId = created.data.user?.id ?? '';
      userEmail = email;
    }

    await linearOAuthRepository.upsert({
      userId,
      accessTokenEncrypted: encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token ?? null,
      linearUserId: viewer.id,
      linearLogin: viewer.name ?? viewer.email ?? viewer.id,
      scope: 'read,write,issues:write',
    });

    const ar = authService.generateTokens(userId, userEmail || (viewer.email ?? userEmail), viewer.name ?? null);
    res.json({ ...ar, linear: { id: viewer.id, name: viewer.name ?? null, email: viewer.email ?? null } });
  } catch (err) {
    log.error({ err }, 'Linear OAuth callback failed');
    res.status(500).json({ error: 'Linear OAuth callback failed' });
  }
});

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await linearOAuthRepository.findByUserId(req.user!.id);
    if (!token) {
      res.json({ connected: false });
      return;
    }
    res.json({ connected: true, linearUserId: token.linearUserId, linearLogin: token.linearLogin });
  } catch (err) {
    log.error({ err }, 'Failed to read Linear connection status');
    res.status(500).json({ error: 'Failed to read Linear connection status' });
  }
});

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
    log.error({ err }, 'Failed to disconnect Linear');
    res.status(500).json({ error: 'Failed to disconnect Linear' });
  }
});

export { router as linearOAuthRouter };
