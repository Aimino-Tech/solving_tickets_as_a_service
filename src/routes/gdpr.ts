import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit/middleware.js';
import { requireAuth } from '../auth/middleware.js';
import {
  anonymizeUserData,
  eraseUserData,
  exportUserData,
  getConsentPreferences,
  setConsentPreference,
} from '../gdpr/service.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'gdpr-api' });

const router: Router = Router();

const consentSchema = z.object({
  key: z.string().min(1).max(50),
  granted: z.boolean(),
});

/**
 * GET /api/v1/gdpr/export — data portability (GDPR Art. 20).
 * Returns a JSON archive of all personal data held about the caller.
 */
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await exportUserData(req.user!.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="stas-user-data-${req.user!.id}.json"`);
    res.json(data);
  } catch (err) {
    log.error({ err: String(err), userId: req.user!.id }, 'Data export failed');
    res.status(500).json({ error: 'Failed to export user data' });
  }
});

/**
 * DELETE /api/v1/gdpr/data — right to erasure (GDPR Art. 17).
 * Deletes the caller's user record and all related personal data. 204 on
 * success; 404 when no local user row exists.
 */
router.delete('/data', requireAuth, async (req: Request, res: Response) => {
  try {
    const erased = await eraseUserData(req.user!.id);
    if (!erased) {
      res.status(404).json({ error: 'No user data found to erase' });
      return;
    }
    auditLog({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'privacy.erasure',
      resourceType: 'account',
      resourceId: req.user!.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    res.status(204).end();
  } catch (err) {
    log.error({ err: String(err), userId: req.user!.id }, 'Data erasure failed');
    res.status(500).json({ error: 'Failed to erase user data' });
  }
});

/**
 * POST /api/v1/gdpr/anonymize — data anonymization tool.
 * Replaces email/name with deterministic hashed placeholders.
 */
router.post('/anonymize', requireAuth, async (req: Request, res: Response) => {
  try {
    const anonymized = await anonymizeUserData(req.user!.id);
    if (!anonymized) {
      res.status(404).json({ error: 'No user data found to anonymize' });
      return;
    }
    res.json({ success: true, message: 'User data anonymized' });
  } catch (err) {
    log.error({ err: String(err), userId: req.user!.id }, 'Data anonymization failed');
    res.status(500).json({ error: 'Failed to anonymize user data' });
  }
});

/**
 * GET /api/v1/gdpr/consent — cookie-consent preferences.
 * Returns the user's consent preferences (defaults for unset keys).
 */
router.get('/consent', requireAuth, async (req: Request, res: Response) => {
  try {
    const prefs = await getConsentPreferences(req.user!.id);
    res.json({ preferences: prefs });
  } catch (err) {
    log.error({ err: String(err), userId: req.user!.id }, 'Failed to get consent preferences');
    res.status(500).json({ error: 'Failed to get consent preferences' });
  }
});

/**
 * PUT /api/v1/gdpr/consent — save a cookie-consent preference.
 * Body: { key: string, granted: boolean }
 */
router.put('/consent', requireAuth, async (req: Request, res: Response) => {
  const parsed = consentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  try {
    await setConsentPreference(req.user!.id, parsed.data.key, parsed.data.granted);
    auditLog({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'privacy.consent',
      resourceType: 'consent',
      resourceId: parsed.data.key,
      details: { granted: parsed.data.granted },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.requestId,
    });
    const prefs = await getConsentPreferences(req.user!.id);
    res.json({ success: true, preferences: prefs });
  } catch (err) {
    log.error({ err: String(err), userId: req.user!.id }, 'Failed to save consent preference');
    res.status(500).json({ error: 'Failed to save consent preference' });
  }
});

export { router as gdprRouter };
