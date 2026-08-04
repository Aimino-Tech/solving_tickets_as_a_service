import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { captureEvent } from '../analytics/tracker.js';
import { auditLog } from '../audit/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { requireAuth } from './middleware.js';
import { loginLimiter, refreshLimiter, registerLimiter } from './rateLimit.js';
import { AuthError, authService } from './service.js';
import { getSupabaseAdmin } from './supabase.js';
import { referralService } from '../referral/service.js'; // AIM-4643

const log = rootLogger.child({ module: 'auth-routes' });

const router: Router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
  referralCode: z.string().max(32).optional(), // AIM-4643
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const magicLinkSchema = z.object({
  email: z.string().email(),
});

const magicLinkVerifySchema = z.object({
  token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  accessToken: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

router.post('/register', registerLimiter, async (req: Request, res: Response) => {
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
        `INSERT INTO users (id, email, name, password_hash, plan, role, subscription_status, referral_code, created_at, updated_at)
         VALUES ($1, $2, $3, 'supabase_auth', 'solo', 'user', 'active', $4, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()`,
        [result.user.id, result.user.email, result.user.name || result.user.email, parsed.data.referralCode ?? null],
      );

      // Sync plan + role to Supabase Auth metadata so JWT carries them
      await getSupabaseAdmin().auth.admin.updateUserById(result.user.id, {
        app_metadata: { plan: 'solo', role: 'user' },
      });
    } catch (dbErr) {
      log.error({ err: String(dbErr) }, 'Failed to create user record — non-fatal');
    }

    // Referral (AIM-4643): create pending $5 rewards for referrer + referee
    if (parsed.data.referralCode) {
      try {
        await referralService.redeem(parsed.data.referralCode, parsed.data.email);
      } catch (refErr) {
        log.warn({ err: String(refErr) }, 'Referral redemption failed — non-fatal');
      }
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

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
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

router.post('/refresh', refreshLimiter, async (req: Request, res: Response) => {
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

router.post('/magic-link', loginLimiter, async (req: Request, res: Response) => {
  const parsed = magicLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    // Always resolve — even for unknown emails (anti-enumeration).
    await authService.issueMagicLink(parsed.data.email);
    auditLog({
      actorType: 'user',
      action: 'auth.magic_link.request',
      resourceType: 'account',
      details: { email: parsed.data.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json({ ok: true, message: 'If an account exists for this email, a sign-in link has been issued.' });
  } catch (err) {
    log.error({ err }, 'Magic link request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/magic-link/verify', async (req: Request, res: Response) => {
  const parsed = magicLinkVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const { sub: userId, email } = authService.verifyMagicLinkToken(parsed.data.token);

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user) {
      throw new AuthError('Invalid or expired magic link', 401);
    }

    const name = (data.user.user_metadata?.name as string | undefined) ?? null;
    const role = (data.user.app_metadata?.role as string | undefined) ?? 'user';
    const result = authService.generateTokens(userId, email, name, role);

    auditLog({
      actorType: 'user',
      actorId: userId,
      action: 'auth.magic_link.verify',
      resourceType: 'account',
      resourceId: userId,
      details: { email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Magic link verification failed');
    res.status(401).json({ error: 'Invalid or expired magic link' });
  }
});

router.post('/forgot-password', loginLimiter, async (req: Request, res: Response) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const host = req.get?.('host') || (req.headers as Record<string, string>)?.host || 'localhost';
    const origin = req.headers.origin || `${req.protocol || 'http'}://${host}`;
    await authService.requestPasswordReset(parsed.data.email, `${origin}/auth/reset-password`);
    auditLog({
      actorType: 'user',
      action: 'auth.password_reset.request',
      resourceType: 'account',
      details: { email: parsed.data.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json({ ok: true, message: 'If an account exists for this email, a password reset link has been sent.' });
  } catch (err) {
    log.error({ err }, 'Password reset request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const { userId } = await authService.resetPasswordWithRecovery(parsed.data.accessToken, parsed.data.password);
    auditLog({
      actorType: 'user',
      actorId: userId,
      action: 'auth.password_reset.complete',
      resourceType: 'account',
      resourceId: userId,
      details: { passwordReset: true },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Password reset failed');
    res.status(500).json({ error: 'Internal server error' });
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
    const email = req.user!.email ?? '';
    let plan: string = 'free';
    let role: string = 'user';
    const userId: string = req.user!.id;
    let name: string | null = null;
    let createdAt: string = new Date().toISOString();
    let appMetadataRole: string | null = null;

    // Try Supabase Auth admin API first
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(req.user!.id);
      if (!error && data?.user) {
        const supaUser = data.user;
        plan = (supaUser.app_metadata?.plan as string) ?? 'free';
        appMetadataRole = (supaUser.app_metadata?.role as string) ?? null;
        role = appMetadataRole ?? 'user';
        name = supaUser.user_metadata?.name ?? null;
        createdAt = supaUser.created_at;
      }
    } catch {
      // Supabase not available — continue with fallback
    }

    // users.role is the platform source of truth (Supabase Auth metadata may lag).
    try {
      const { resolvePlatformRole } = await import('./roles.js');
      role = await resolvePlatformRole({
        userId,
        email,
        appMetadataRole,
        syncToSupabase: !req.user!.impersonatorId,
      });
    } catch {
      // keep role from metadata
    }

    // Fallback: if plan is still 'free', check accounts table for overrides.
    if (plan === 'free' && email) {
      try {
        const acctResult = await queryWithRetry<{ plan: string; name: string | null }>(
          'SELECT plan, name FROM accounts WHERE email = $1',
          [email],
        );
        if (acctResult.rows.length > 0) {
          const acctPlan = acctResult.rows[0].plan;
          if (acctPlan && acctPlan !== 'free') {
            plan = acctPlan === 'pro' ? 'solo' : acctPlan;
          }
          if (!name) name = acctResult.rows[0].name;
        }
      } catch {
        // accounts table unavailable — ignore
      }
    }

    const isAdmin =
      !req.user!.impersonatorId &&
      (role === 'admin' || config.adminSteering.adminEmails.includes(email.toLowerCase()));

    const body: Record<string, unknown> = {
      id: userId,
      email,
      name,
      plan,
      role,
      createdAt,
      isAdmin,
    };

    if (req.user!.impersonatorId) {
      body.impersonating = true;
      body.impersonator = {
        id: req.user!.impersonatorId,
        email: req.user!.impersonatorEmail ?? '',
      };
      body.isAdmin = false;
    } else if (role && role !== (req.user!.role ?? 'user')) {
      // Stale JWT (role changed after login) — hand the client fresh tokens.
      const tokens = authService.generateTokens(userId, email, name, role);
      body.token = tokens.token;
      body.refreshToken = tokens.refreshToken;
    }

    res.json(body);
  } catch (err) {
    log.error({ err }, 'Failed to get user');
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
