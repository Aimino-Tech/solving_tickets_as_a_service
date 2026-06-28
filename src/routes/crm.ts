import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { Queue } from 'bullmq';
import type { CrmSyncJobData } from '../crm/types.js';
import { enqueueWebhookEvent } from '../crm/crmSyncService.js';
import { createOrUpdateContact } from '../crm/loopsApi.js';

const log = rootLogger.child({ module: 'crm-routes' });

export function createCrmRouter(crmQueue: Queue<CrmSyncJobData>): Router {
  const router: Router = Router();

  router.post('/webhook/loops', async (req: Request, res: Response) => {
    const signature = req.headers['webhook-signature'] as string;
    const webhookId = req.headers['webhook-id'] as string;
    const rawBody = (req as { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    if (config.crm.webhookSecret && signature) {
      const crypto = await import('node:crypto');
      const expectedSig = crypto
        .createHmac('sha256', config.crm.webhookSecret)
        .update(rawBody)
        .digest('hex');

      const receivedSigs = signature.split(' ').map(s => s.trim());
      const isValid = receivedSigs.some(s => s === expectedSig);

      if (!isValid) {
        log.warn({ webhookId }, 'Invalid Loops webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    const p = payload as Record<string, unknown>;
    const eventName = p.eventName as string;
    const contact = p.contact as Record<string, unknown> ?? {};
    const source = 'loops';

    log.info({ eventName, webhookId }, 'Received Loops webhook');

    if (eventName === 'contact.unsubscribed') {
      await createOrUpdateContact({
        ...contact as Record<string, unknown>,
        source,
      } as Record<string, unknown> as Parameters<typeof createOrUpdateContact>[0]);
    }

    await enqueueWebhookEvent(crmQueue, payload as Parameters<typeof enqueueWebhookEvent>[1]);
    res.status(202).json({ accepted: true });
  });

  router.post('/api/v1/crm/sync/contact', async (req: Request, res: Response) => {
    try {
      const contactData = req.body as Parameters<typeof createOrUpdateContact>[0];
      if (!contactData?.email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      const result = await createOrUpdateContact(contactData);
      if (result.success) {
        res.json({ success: true, contactId: result.id });
      } else {
        res.status(502).json({ error: 'Failed to sync contact with Loops' });
      }
    } catch (err) {
      log.error({ err: String(err) }, 'CRM contact sync API error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/api/v1/crm/health', (_req: Request, res: Response) => {
    res.json({
      configured: !!config.crm.loopsApiKey,
      syncIntervalMinutes: config.crm.syncIntervalMinutes,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
