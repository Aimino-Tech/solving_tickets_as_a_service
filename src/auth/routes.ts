import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from './supabase.js';
import { rootLogger } from '../utils/logger.js';
import { captureEvent } from '../analytics/tracker.js';
import { requireAuth } from './middleware.js';
import { AuthError, authService } from './service.js';
import { loginLimiter, registerLimiter, refreshLimiter } from './rateLimit.js';

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

router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.register(parsed.data.email, parsed.data.password, parsed.data.name);

    // Track user signup in PostHog
    try {
      captureEvent('user_signup', result.user.id, {
        email: result.user.email,
        name: result.user.name,
      });
    } catch (analyticsErr) {
      log.error({ err: String(analyticsErr) }, 'Failed to track user_signup event');
    }

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
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
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
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

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

router.post('/verify-email', async (req: Request, res: Response) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.verifyEmail(parsed.data.token);
    res.json({ message: 'Email verified successfully', email: result.email });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Email verification failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-verification', async (req: Request, res: Response) => {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.resendVerification(parsed.data.email);
    res.json({ message: 'Verification email resent', verificationToken: result.verificationToken });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Resend verification failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(req.user!.id);
  if (error || !data.user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const user = data.user;
  res.json({
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name ?? null,
    createdAt: user.created_at,
  });
});

export default router;
