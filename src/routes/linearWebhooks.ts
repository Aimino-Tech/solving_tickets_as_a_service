import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'linear-webhook' });

const router: Router = Router();

const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET || '';

function verifySignature(payload: string, signature: string): boolean {
  if (!LINEAR_WEBHOOK_SECRET) {
    log.warn('LINEAR_WEBHOOK_SECRET not set — rejecting webhook');
    return false;
  }
  const expected = crypto
    .createHmac('sha256', LINEAR_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

router.post('/linear', (req: Request, res: Response) => {
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
    if (issueId) {
      log.info({ issueId }, 'Queueing immediate triage for updated issue');
    }
  }

  res.json({ success: true });
});

export { router as linearWebhookRouter };
