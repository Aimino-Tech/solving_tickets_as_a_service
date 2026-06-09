import { Router, type Request, type Response } from 'express';
import { verifyLinearWebhookSignature, handleLinearWebhook } from '../trackers/linear.js';
import { bridgeLinearTicket } from '../trackers/linearBridge.js';
import { logWebhookReceived, logWebhookProcessed, logWebhookFailed } from './eventLogger.js';
import { recordWebhookDuration } from './metrics.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'linear-webhook' });

const router = Router();

router.post('/webhooks/linear', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const rawBody = (req as { rawBody?: Buffer }).rawBody;
  const source = 'linear';
  const signature = req.headers['linear-signature'] as string | undefined;
  const deliveryId = req.headers['linear-delivery'] as string | undefined;
  const eventType = req.headers['linear-event'] as string | undefined;

  let eventId: number | undefined;
  try {
    eventId = await logWebhookReceived({
      source,
      eventType: eventType || 'unknown',
      deliveryId,
      payload: { note: 'Linear webhook received' },
    });
  } catch {
    // non-fatal
  }

  try {
    if (!rawBody) {
      res.status(400).json({ error: 'missing raw body' });
      return;
    }

    if (!verifyLinearWebhookSignature(rawBody, signature || '')) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const result = await handleLinearWebhook(payload);

    if (result?.ticketId && (result.action === 'create' || result.action === 'update')) {
      bridgeLinearTicket(result.ticketId).catch((err) => {
        log.error({ err: String(err), ticketId: result.ticketId }, 'Bridge to GitHub issue failed');
      });
    }

    if (eventId) await logWebhookProcessed(eventId);
    recordWebhookDuration(source, Date.now() - startTime);
    res.json({ received: true, ticketId: result?.ticketId || null });
  } catch (err) {
    log.error({ err: String(err) }, 'Linear webhook processing failed');
    if (eventId) await logWebhookFailed(eventId, String(err));
    recordWebhookDuration(source, Date.now() - startTime);
    res.json({ received: true });
  }
});

export { router as linearWebhookRouter };
