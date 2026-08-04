/**
 * Admin Users API — list / detail / role change / impersonate.
 *
 * Mounted at /api/v1/admin/users.
 * Requires dashboard JWT with platform admin role (not impersonation tokens).
 *
 * @module routes/adminUsers
 */

import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { logAdminAction } from '../audit/service.js';
import { requireAuth, requirePlatformAdmin } from '../auth/middleware.js';
import { authService } from '../auth/service.js';
import { getSupabaseAdmin } from '../auth/supabase.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'admin-users' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string | null;
  role: string;
  created_at: Date | string;
}

interface AccountRow {
  id: string | number;
  email: string | null;
  plan: string | null;
  name: string | null;
}

const roleBodySchema = z.object({
  role: z.enum(['admin', 'user']),
});

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    plan: row.plan ?? 'free',
    role: row.role || 'user',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export function createAdminUsersRouter(): Router {
  const router = Router();

  router.use(requireAuth);

  // Exit must work while impersonating (no requirePlatformAdmin).
  router.post('/impersonate/exit', async (req: Request, res: Response) => {
    try {
      if (!req.user?.impersonatorId) {
        res.status(400).json({ error: 'Not currently impersonating' });
        return;
      }
      await logAdminAction({
        adminId: req.user.impersonatorId,
        action: 'admin.impersonate.exit',
        resourceType: 'user',
        resourceId: req.user.id,
        details: {
          targetEmail: req.user.email,
          impersonatorEmail: req.user.impersonatorEmail,
        },
        ipAddress: req.ip,
        correlationId: req.requestId,
      });
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to audit impersonation exit');
      res.status(500).json({ error: 'Failed to exit impersonation' });
    }
  });

  router.use(requirePlatformAdmin);

  router.get('/', async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const offset = (page - 1) * limit;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim() : '';

      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (q) {
        conditions.push(`(email ILIKE $${idx} OR COALESCE(name, '') ILIKE $${idx})`);
        values.push(`%${q}%`);
        idx++;
      }
      if (roleFilter === 'admin' || roleFilter === 'user') {
        conditions.push(`role = $${idx}`);
        values.push(roleFilter);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await queryWithRetry<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM users ${where}`,
        values,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const listValues = [...values, limit, offset];
      const listResult = await queryWithRetry<UserRow>(
        `SELECT id, email, name, plan, role, created_at
         FROM users
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        listValues,
      );

      const totalPages = Math.max(1, Math.ceil(total / limit));
      res.json({
        users: listResult.rows.map(serializeUser),
        page,
        limit,
        total,
        totalPages,
      });
    } catch (err) {
      log.error({ err }, 'Failed to list users');
      res.status(500).json({ error: 'Failed to list users' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }

      const userResult = await queryWithRetry<UserRow>(
        `SELECT id, email, name, plan, role, created_at FROM users WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (userResult.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const user = userResult.rows[0];
      let accounts: AccountRow[] = [];
      try {
        const acctResult = await queryWithRetry<AccountRow>(
          `SELECT id, email, plan, name FROM accounts
           WHERE user_id = $1 OR email = $2
           ORDER BY id ASC
           LIMIT 50`,
          [id, user.email],
        );
        accounts = acctResult.rows;
      } catch {
        // accounts join optional
      }

      res.json({
        ...serializeUser(user),
        accounts: accounts.map((a) => ({
          id: String(a.id),
          email: a.email,
          plan: a.plan,
          name: a.name,
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get user');
      res.status(500).json({ error: 'Failed to get user' });
    }
  });

  router.patch('/:id/role', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }

      const parsed = roleBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'role must be admin or user' });
        return;
      }
      const newRole = parsed.data.role;

      const userResult = await queryWithRetry<UserRow>(
        `SELECT id, email, name, plan, role, created_at FROM users WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (userResult.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const target = userResult.rows[0];
      const prevRole = target.role || 'user';

      if (newRole === 'user' && prevRole === 'admin' && req.user!.id === id) {
        const adminCount = await queryWithRetry<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM users WHERE role = 'admin'`,
        );
        if (Number(adminCount.rows[0]?.total ?? 0) <= 1) {
          res.status(400).json({ error: 'Cannot demote the last platform admin' });
          return;
        }
      }

      await queryWithRetry(`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`, [newRole, id]);

      try {
        await getSupabaseAdmin().auth.admin.updateUserById(id, {
          app_metadata: { role: newRole },
        });
      } catch (supaErr) {
        log.warn({ err: String(supaErr), userId: id }, 'Failed to sync role to Supabase app_metadata');
      }

      await logAdminAction({
        adminId: req.user!.id,
        action: 'admin.user.role_change',
        resourceType: 'user',
        resourceId: id,
        details: { email: target.email, from: prevRole, to: newRole },
        ipAddress: req.ip,
        correlationId: req.requestId,
      });

      res.json({ id, email: target.email, role: newRole });
    } catch (err) {
      log.error({ err }, 'Failed to change user role');
      res.status(500).json({ error: 'Failed to change user role' });
    }
  });

  router.post('/:id/impersonate', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }

      if (req.user!.id === id) {
        res.status(400).json({ error: 'Cannot impersonate yourself' });
        return;
      }

      const userResult = await queryWithRetry<UserRow>(
        `SELECT id, email, name, plan, role, created_at FROM users WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (userResult.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const target = userResult.rows[0];

      const result = authService.generateTokens(target.id, target.email, target.name, target.role || 'user', {
        impersonatorId: req.user!.id,
        impersonatorEmail: req.user!.email,
      });

      await logAdminAction({
        adminId: req.user!.id,
        action: 'admin.impersonate.start',
        resourceType: 'user',
        resourceId: id,
        details: {
          targetEmail: target.email,
          impersonatorEmail: req.user!.email,
        },
        ipAddress: req.ip,
        correlationId: req.requestId,
      });

      res.json({
        token: result.token,
        refreshToken: result.refreshToken,
        user: {
          id: target.id,
          email: target.email,
          name: target.name,
          role: target.role || 'user',
          plan: target.plan ?? 'free',
          createdAt: serializeUser(target).createdAt,
        },
        impersonator: { id: req.user!.id, email: req.user!.email },
      });
    } catch (err) {
      log.error({ err }, 'Failed to impersonate user');
      res.status(500).json({ error: 'Failed to impersonate user' });
    }
  });

  return router;
}

export const adminUsersRouter = createAdminUsersRouter();
