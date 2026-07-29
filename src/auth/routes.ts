import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { usersRepository } from '../db/repositories/UsersRepository.js';
import { rootLogger } from '../utils/logger.js';
import { captureEvent } from '../analytics/tracker.js';
import { requireAuth } from './middleware.js';
import { AuthError, authService } from './service.js';

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

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const result = await authService.register(parsed.data.email, parsed.data.password, parsed.data.name);

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

router.post('/login', async (req: Request, res: Response) => {
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

router.post('/logout', async (req: Request, res: Response) => {
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.json({ message: 'Logged out successfully' });
    return;
  }

  if (parsed.data.refreshToken) {
    try {
      await authService.revokeRefreshToken(parsed.data.refreshToken);
    } catch {
      // Token may already be revoked or expired — still consider logout successful
    }
  }

  res.json({ message: 'Logged out successfully' });
});

router.post('/revoke-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const count = await authService.revokeAllUserTokens(req.user!.id);
    res.json({ message: `Revoked ${count} refresh token(s)` });
  } catch (err) {
    log.error({ err }, 'Failed to revoke all tokens');
    res.status(500).json({ error: 'Failed to revoke tokens' });
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await usersRepository.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  });
});

export default router;
