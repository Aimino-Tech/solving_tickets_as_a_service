import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from './supabase.js';
import { rootLogger } from '../utils/logger.js';
import { captureEvent } from '../analytics/tracker.js';
import { requireAuth } from './middleware.js';
import { AuthError, authService } from './service.js';
import { queryWithRetry } from '../db/connection.js';
import { auditLog } from '../audit/middleware.js';

const log = rootLogger.child({ module: 'auth-routes' });

const router: Router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.register(parsed.data.email, parsed.data.password, parsed.data.name);

    // Create user record in local DB and sync plan to auth metadata
    try {
      await queryWithRetry(
        `INSERT INTO users (id, email, name, password_hash, plan, subscription_status, created_at, updated_at)
         VALUES ($1, $2, $3, 'supabase_auth', 'solo', 'active', NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()`,
        [result.user.id, result.user.email, result.user.name || result.user.email],
      );

      // Sync plan to Supabase Auth metadata so JWT carries it
      await getSupabaseAdmin().auth.admin.updateUserById(result.user.id, {
        app_metadata: { plan: 'solo' },
      });
    } catch (dbErr) {
      log.error({ err: String(dbErr) }, 'Failed to create user record — non-fatal');
    }

    // Track user signup in PostHog
    try {
      captureEvent('user_signup', result.user.id, {
        email: result.user.email,
        name: result.user.name,
      });
    } catch (analyticsErr) {
      log.error({ err: String(analyticsErr) }, 'Failed to track user_signup event');
    }

    auditLog({
      actorType: 'user',
      actorId: result.user.id,
      action: 'auth.register',
      resourceType: 'account',
      resourceId: result.user.id,
      details: { email: parsed.data.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      auditLog({
        actorType: 'user',
        action: 'auth.register',
        resourceType: 'account',
        details: { email: parsed.data?.email, error: err.message },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: req.requestId,
      });
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Registration failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.login(parsed.data.email, parsed.data.password);
    auditLog({
      actorType: 'user',
      actorId: result.user.id,
      action: 'auth.login',
      resourceType: 'account',
      resourceId: result.user.id,
      details: { email: parsed.data.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      auditLog({
        actorType: 'user',
        action: 'auth.login',
        resourceType: 'account',
        details: { email: parsed.data?.email, error: err.message },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: req.requestId,
      });
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Login failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.refreshToken(parsed.data.refreshToken);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', requireAuth, (req: Request, res: Response) => {
  auditLog({
    actorType: 'user',
    actorId: req.user!.id,
    action: 'auth.logout',
    resourceType: 'account',
    resourceId: req.user!.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    correlationId: req.requestId,
  });
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(req.user!.id);
    if (!error && data?.user) {
      const user = data.user;
      const plan = user.app_metadata?.plan as string | undefined;
      res.json({
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name ?? null,
        plan: plan ?? 'free',
        createdAt: user.created_at,
      });
      return;
    }
  } catch {
    // Supabase not available in dev — fall through to JWT data
  }
  res.json({
    id: req.user!.id,
    email: req.user!.email ?? 'dev@test.com',
    name: 'Dev User',
    plan: 'free',
    createdAt: new Date().toISOString(),
  });
});

export default router;
