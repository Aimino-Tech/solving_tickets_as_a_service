import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'invites-routes' });

const router: Router = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.string().max(50).optional(),
});

/**
 * Invite-by-email (Linear 2713). Creates a pending invite row and issues a
 * log-based invite link — no email provider is wired, matching the magic-link
 * delivery pattern.
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const email = parsed.data.email;
    const role = parsed.data.role ?? 'member';
    const token = randomUUID();

    await queryWithRetry(
      `INSERT INTO invites (email, invited_by, role, token, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())
       ON CONFLICT (email) DO UPDATE SET token = EXCLUDED.token, status = 'pending'`,
      [email, req.user!.id, role, token],
    );

    log.info(
      { email, invitedBy: req.user!.id, inviteUrl: `/accept-invite?token=${token}` },
      'Invite issued — log-based delivery (no email provider configured)',
    );

    res.status(201).json({ invited: true, email });
  } catch (err) {
    log.error({ err, userId: req.user!.id }, 'Failed to create invite');
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

/**
 * List invites issued by the authenticated user.
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await queryWithRetry<Record<string, unknown>>(
      `SELECT id, email, role, status, created_at, accepted_at
       FROM invites WHERE invited_by = $1 ORDER BY created_at DESC`,
      [req.user!.id],
    );
    res.json({ invites: result.rows });
  } catch (err) {
    log.error({ err, userId: req.user!.id }, 'Failed to list invites');
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

export { router as inviteRouter };
