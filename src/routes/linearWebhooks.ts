import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { rootLogger } from '../utils/logger.js';
<<<<<<< HEAD
import { publish } from '../queue/rabbitmq.js';
=======
>>>>>>> origin/main

const log = rootLogger.child({ module: 'linear-webhook' });

const router = Router();

const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET || '';

function verifySignature(payload: string, signature: string): boolean {
  if (!LINEAR_WEBHOOK_SECRET) {
    log.warn('LINEAR_WEBHOOK_SECRET not set — webhook signature verification disabled');
    return true;
  }
  const expected = crypto
    .createHmac('sha256', LINEAR_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

<<<<<<< HEAD
router.post('/linear', async (req: Request, res: Response) => {
=======
router.post('/linear', (req: Request, res: Response) => {
>>>>>>> origin/main
  const signature = req.headers['linear-signature'] as string;
  const rawBody = JSON.stringify(req.body);

  if (signature && !verifySignature(rawBody, signature)) {
    log.warn('Invalid Linear webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = req.body;
  log.info({ action: event.action, type: event.type }, 'Linear webhook received');

  if (event.type === 'Issue' && event.action === 'update') {
    const issueId = event.data?.id;
<<<<<<< HEAD
    const issueData = event.data;
    if (issueId) {
      log.info({ issueId }, 'Dispatching immediate triage for updated issue');
      try {
        await publish('stas.issues', 'triage.linear', {
          type: 'linear_webhook',
          issue_id: issueId,
          identifier: issueData?.identifier || '',
          title: issueData?.title || '',
          description: issueData?.description || '',
          labels: issueData?.labels || [],
          url: issueData?.url || '',
          state: issueData?.state,
          timestamp: new Date().toISOString(),
        });
        log.info({ issueId }, 'Triage message published to stas.issues');
      } catch (err) {
        log.error({ err: String(err), issueId }, 'Failed to publish triage message');
      }
=======
    if (issueId) {
      log.info({ issueId }, 'Queueing immediate triage for updated issue');
>>>>>>> origin/main
    }
  }

  res.json({ success: true });
});

export { router as linearWebhookRouter };
