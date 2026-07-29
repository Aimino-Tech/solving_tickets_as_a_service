import { Router } from 'express';
import { classifyTicket, type TicketCategory } from '../classifier/ticketClassifier.js';
import { getTracker } from '../trackers/index.js';
import { postNonCodeResult } from '../trackers/nonCodeResult.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'ticket-result' });
const router: Router = Router();

router.post('/api/v1/ticket-result', async (req, res) => {
  try {
    const { tracker_type, tracker_ticket_id, title, body, labels, summary, details, evidence_urls } = req.body;

    if (!tracker_ticket_id || !title) {
      res.status(400).json({ error: 'Missing required fields: tracker_ticket_id, title' });
      return;
    }

    const classification = classifyTicket(title, body, labels);

    if (classification.isCodeRelated) {
      res.json({ category: 'code', isCodeRelated: true, note: 'Code ticket — no result posting needed' });
      return;
    }

    const result = {
      ticketId: tracker_ticket_id,
      category: classification.category as TicketCategory,
      summary: summary || 'Non-code task completed',
      details: details || classification.reasoning,
      evidenceUrls: evidence_urls || [],
    };

    await postNonCodeResult(tracker_type || 'linear', result);

    const tracker = getTracker(tracker_type || 'linear');
    if (tracker) {
      await tracker.updateStatus(tracker_ticket_id, 'In Review');
    }

    log.info({ ticketId: tracker_ticket_id, category: classification.category }, 'Non-code result posted');
    res.json({
      success: true,
      category: classification.category,
      isCodeRelated: false,
      posted: true,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Ticket result handler error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/v1/ticket-result/classify', async (req, res) => {
  try {
    const { title, body, labels } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Missing required field: title' });
      return;
    }
    const classification = classifyTicket(title, body, labels);
    res.json(classification);
  } catch (err) {
    log.error({ err: String(err) }, 'Ticket classification error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
