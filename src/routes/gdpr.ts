import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit/middleware.js';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { eraseUserData, exportUserData, getCookiePreferences, setCookiePreferences } from '../gdpr/service.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'gdpr-routes' });

const router: Router = Router();

const preferencesSchema = z.record(z.boolean());

router.delete('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    await eraseUserData(user.id, user.email);
    await auditLog({
      actorType: 'user',
      actorId: user.id,
      action: 'gdpr.erasure',
      resourceType: 'account',
      resourceId: user.id,
      details: { email: user.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.status(204).end();
  } catch (err) {
    log.error({ err: String(err) }, 'GDPR erasure failed');
    res.status(500).json({ error: 'Erasure failed' });
  }
});

router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const archive = await exportUserData(user.id, user.email);
    await auditLog({
      actorType: 'user',
      actorId: user.id,
      action: 'gdpr.export',
      resourceType: 'account',
      resourceId: user.id,
      details: { generatedAt: archive.generatedAt },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.setHeader('Content-Disposition', 'attachment; filename="stas-user-data.json"');
    res.json(archive);
  } catch (err) {
    log.error({ err: String(err) }, 'GDPR export failed');
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/cookie-preferences', requireAuth, async (req: Request, res: Response) => {
  try {
    const prefs = await getCookiePreferences(req.user!.id);
    res.json(prefs);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to read cookie preferences');
    res.status(500).json({ error: 'Failed to read cookie preferences' });
  }
});

router.put('/cookie-preferences', requireAuth, async (req: Request, res: Response) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  try {
    const prefs = await setCookiePreferences(req.user!.id, parsed.data);
    await auditLog({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'gdpr.cookie_preferences',
      resourceType: 'account',
      resourceId: req.user!.id,
      details: { categories: Object.keys(parsed.data) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.json(prefs);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to save cookie preferences');
    res.status(500).json({ error: 'Failed to save cookie preferences' });
  }
});

const CONSENT_CATEGORIES = [
  { id: 'necessary', required: true, label: 'Necessary', description: 'Required for the service to function.' },
  { id: 'analytics', required: false, label: 'Analytics', description: 'Helps us understand usage and improve STAS.' },
  { id: 'marketing', required: false, label: 'Marketing', description: 'Used to share product updates and offers.' },
];

router.get('/consent-config', async (_req: Request, res: Response) => {
  res.json({
    required: true,
    version: '2026-01',
    text: 'We use cookies to make STAS work and to understand usage. You can manage your preferences below.',
    categories: CONSENT_CATEGORIES,
  });
});

router.get('/data-retention', async (_req: Request, res: Response) => {
  try {
    const result = await queryWithRetry<{ name: string; value: string | null }>(
      "SELECT name, value FROM config WHERE name = 'data_retention_days'",
    );
    const retentionDays = result.rows[0]?.value ? Number(result.rows[0].value) : 30;
    res.json({ retentionDays });
  } catch {
    res.json({ retentionDays: 30 });
  }
});

export default router;
