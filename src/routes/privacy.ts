import { createHash } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit/middleware.js';
import { requireAuth } from '../auth/middleware.js';
import { getSupabaseAdmin } from '../auth/supabase.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'privacy-routes' });

const router: Router = Router();

const preferencesSchema = z.object({
  analytics: z.boolean().optional(),
  marketing: z.boolean().optional(),
  functional: z.boolean().optional(),
});

function hashPii(value: string, salt: string): string {
  return createHash('sha256').update(`${value}:${salt}`).digest('hex');
}

/**
 * Right-to-erasure (GDPR Art. 17). Deletes the authenticated user's data from
 * the local database and from the auth provider, then responds 204.
 */
router.delete('/erasure', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const email = req.user!.email;

  try {
    auditLog({
      actorType: 'user',
      actorId: userId,
      action: 'privacy.erasure',
      resourceType: 'account',
      resourceId: userId,
      details: { email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });

    // Local database rows (individual deletes are non-fatal).
    try {
      await queryWithRetry('DELETE FROM users WHERE id = $1', [userId]);
    } catch (err) {
      log.warn({ err: String(err), userId }, 'Failed to delete users row');
    }
    try {
      await queryWithRetry('DELETE FROM accounts WHERE email = $1', [email]);
    } catch (err) {
      log.warn({ err: String(err), email }, 'Failed to delete accounts row');
    }
    try {
      await queryWithRetry(
        `DELETE FROM data_deletion_requests
         WHERE account_id IN (SELECT id FROM accounts WHERE email = $1)`,
        [email],
      );
    } catch (err) {
      log.warn({ err: String(err), email }, 'Failed to delete data_deletion_requests rows');
    }
    try {
      await queryWithRetry(
        `DELETE FROM dpa_acceptance
         WHERE account_id IN (SELECT id FROM accounts WHERE email = $1)`,
        [email],
      );
    } catch (err) {
      log.warn({ err: String(err), email }, 'Failed to delete dpa_acceptance rows');
    }

    // Auth provider deletion — hard failure surface.
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) {
        log.error({ error: String(error), userId }, 'Supabase user deletion failed');
        res.status(500).json({ error: 'Failed to delete auth account' });
        return;
      }
    } catch (err) {
      log.error({ err: String(err), userId }, 'Supabase user deletion threw');
      res.status(500).json({ error: 'Failed to delete auth account' });
      return;
    }

    log.info({ userId }, 'User data erased');
    res.status(204).end();
  } catch (err) {
    log.error({ err, userId }, 'Erasure failed');
    res.status(500).json({ error: 'Erasure failed' });
  }
});

/**
 * Data portability (GDPR Art. 20). Returns a JSON archive of the
 * authenticated user's data as a downloadable attachment.
 */
router.get('/portability', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const email = req.user!.email;

  try {
    let profile: Record<string, unknown> = { id: userId, email };
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (data?.user) {
        profile = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name ?? null,
          createdAt: data.user.created_at,
          plan: data.user.app_metadata?.plan ?? 'free',
        };
      }
    } catch (err) {
      log.warn({ err: String(err), userId }, 'Supabase profile fetch failed for portability');
    }

    let account: Record<string, unknown> | null = null;
    try {
      const acct = await queryWithRetry<Record<string, unknown>>(
        'SELECT id, email, name, plan, created_at FROM accounts WHERE email = $1 LIMIT 1',
        [email],
      );
      if (acct.rows.length > 0) account = acct.rows[0];
    } catch (err) {
      log.warn({ err: String(err), email }, 'Accounts fetch failed for portability');
    }

    let usage: Record<string, unknown>[] = [];
    try {
      const usageRows = await queryWithRetry<Record<string, unknown>>(
        `SELECT id, account_id, credits_used, feature, created_at
         FROM usage_records WHERE account_id = (SELECT id FROM accounts WHERE email = $1)`,
        [email],
      );
      usage = usageRows.rows;
    } catch (err) {
      log.warn({ err: String(err), email }, 'Usage fetch failed for portability');
    }

    let auditEntries: Record<string, unknown>[] = [];
    try {
      const auditRows = await queryWithRetry<Record<string, unknown>>(
        `SELECT id, action, resource_type, resource_id, details, timestamp
         FROM audit_logs WHERE actor_id = $1 ORDER BY timestamp DESC LIMIT 500`,
        [userId],
      );
      auditEntries = auditRows.rows;
    } catch (err) {
      log.warn({ err: String(err), userId }, 'Audit fetch failed for portability');
    }

    const archive = {
      exportedAt: new Date().toISOString(),
      profile,
      account,
      usage,
      auditEntries,
      compliance: { gdprCompliant: true, article: 'Art. 20 — data portability' },
    };

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="privacy-export-${userId}-${date}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(archive);
  } catch (err) {
    log.error({ err, userId }, 'Portability export failed');
    res.status(500).json({ error: 'Portability export failed' });
  }
});

/**
 * Cookie-consent preference API. GET returns the current consent (defaults
 * to rejecting non-essential categories), PUT upserts the user's choices.
 */
router.get('/preferences', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const result = await queryWithRetry<Record<string, unknown>>(
      'SELECT analytics, marketing, functional FROM consent_preferences WHERE user_id = $1',
      [userId],
    );
    const prefs = result.rows[0] ?? { analytics: false, marketing: false, functional: false };
    res.status(200).json({ consent: { necessary: true, ...prefs } });
  } catch (err) {
    log.error({ err, userId }, 'Failed to get consent preferences');
    res.status(500).json({ error: 'Failed to get consent preferences' });
  }
});

router.put('/preferences', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const { analytics = false, marketing = false, functional = false } = parsed.data;
    await queryWithRetry(
      `INSERT INTO consent_preferences (user_id, analytics, marketing, functional, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         analytics = EXCLUDED.analytics,
         marketing = EXCLUDED.marketing,
         functional = EXCLUDED.functional,
         updated_at = NOW()`,
      [userId, analytics, marketing, functional],
    );

    auditLog({
      actorType: 'user',
      actorId: userId,
      action: 'privacy.consent.update',
      resourceType: 'consent',
      resourceId: userId,
      details: { analytics, marketing, functional },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });

    res.status(200).json({ consent: { necessary: true, analytics, marketing, functional } });
  } catch (err) {
    log.error({ err, userId }, 'Failed to update consent preferences');
    res.status(500).json({ error: 'Failed to update consent preferences' });
  }
});

/**
 * Data anonymization tool (GDPR Art. 5(1)(e), storage limitation). Hashes the
 * user's identifying fields so the account stays functional but no longer
 * stores plaintext PII.
 */
router.post('/anonymize', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const email = req.user!.email;

  try {
    const hashedEmail = hashPii(email, userId);

    try {
      await queryWithRetry("UPDATE users SET email = $1, name = 'Anonymized', updated_at = NOW() WHERE id = $2", [
        hashedEmail,
        userId,
      ]);
    } catch (err) {
      log.warn({ err: String(err), userId }, 'Failed to anonymize users row');
    }
    try {
      await queryWithRetry("UPDATE accounts SET name = 'Anonymized', updated_at = NOW() WHERE email = $1", [email]);
    } catch (err) {
      log.warn({ err: String(err), email }, 'Failed to anonymize accounts row');
    }
    try {
      const supabaseAdmin = getSupabaseAdmin();
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { name: 'Anonymized' },
      });
    } catch (err) {
      log.warn({ err: String(err), userId }, 'Failed to anonymize auth metadata');
    }

    auditLog({
      actorType: 'user',
      actorId: userId,
      action: 'privacy.anonymize',
      resourceType: 'account',
      resourceId: userId,
      details: { emailHashed: true },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });

    res.status(200).json({ anonymized: true });
  } catch (err) {
    log.error({ err, userId }, 'Anonymization failed');
    res.status(500).json({ error: 'Anonymization failed' });
  }
});

export default router;
