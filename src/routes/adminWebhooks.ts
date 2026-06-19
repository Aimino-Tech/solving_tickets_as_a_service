/**
 * Admin webhook management routes.
 *
 * Provides API endpoints for viewing, filtering, and replaying webhook events.
 * All routes are protected by admin authentication middleware.
 *
 * ── Endpoints ─────────────────────────────────────────────────────────
 * GET    /admin/webhooks              — List webhook events (paginated, filterable)
 * POST   /admin/webhooks/:id/replay   — Replay a single webhook event
 * POST   /admin/webhooks/replay-range — Replay all webhooks in a date range
 * GET    /admin/webhooks/sources      — List unique sources
 * GET    /admin/webhooks/stats        — Status distribution counts
 * ──────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response } from 'express';
import { webhookEventsRepository } from '../db/repositories/WebhookEventsRepository.js';
import { adminAuthMiddleware } from '../security/adminAuth.js';
import { rootLogger } from '../utils/logger.js';
import type { WebhookEventsFilter } from '../db/repositories/WebhookEventsRepository.js';

const log = rootLogger.child({ module: 'admin-webhooks' });

const router: Router = Router();

// All admin webhook routes require authentication
router.use(adminAuthMiddleware);

/**
 * GET /admin/webhooks — List webhook events (paginated, filterable by source/status).
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: WebhookEventsFilter = {
      source: req.query.source as string | undefined,
      status: req.query.status as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };

    // Clamp pagination
    if (filter.limit && (filter.limit < 1 || filter.limit > 200)) filter.limit = 50;
    if (filter.offset && filter.offset < 0) filter.offset = 0;

    const result = await webhookEventsRepository.list(filter);

    res.json({
      events: result.events,
      total: result.total,
      limit: filter.limit,
      offset: filter.offset,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list webhook events');
    res.status(500).json({ error: 'Failed to list webhook events' });
  }
});

/**
 * GET /admin/webhooks/sources — List unique webhook sources.
 */
router.get('/sources', async (_req: Request, res: Response) => {
  try {
    const sources = await webhookEventsRepository.listSources();
    res.json({ sources });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list webhook sources');
    res.status(500).json({ error: 'Failed to list webhook sources' });
  }
});

/**
 * GET /admin/webhooks/stats — Status distribution counts.
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const counts = await webhookEventsRepository.statusCounts();
    res.json({ counts });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get webhook status counts');
    res.status(500).json({ error: 'Failed to get webhook status counts' });
  }
});

/**
 * POST /admin/webhooks/:id/replay — Re-submit a single webhook for processing.
 */
router.post('/:id/replay', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid webhook event ID' });
      return;
    }

    const event = await webhookEventsRepository.findById(id);
    if (!event) {
      res.status(404).json({ error: 'Webhook event not found' });
      return;
    }

    const updated = await webhookEventsRepository.markForReplay(id);
    log.info(
      { eventId: id, source: event.source, eventType: event.eventType },
      'Webhook event queued for replay',
    );

    res.json({ replayed: true, event: updated });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to replay webhook event');
    res.status(500).json({ error: 'Failed to replay webhook event' });
  }
});

/**
 * POST /admin/webhooks/replay-range — Replay all webhooks in a date range.
 *
 * Body: { startDate: ISO string, endDate: ISO string, source?: string }
 */
router.post('/replay-range', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, source } = req.body;

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required (ISO 8601 format)' });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      res.status(400).json({ error: 'Invalid date format — use ISO 8601' });
      return;
    }

    if (start >= end) {
      res.status(400).json({ error: 'startDate must be before endDate' });
      return;
    }

    const count = await webhookEventsRepository.replayRange({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      source: source || undefined,
    });

    log.info(
      { count, startDate, endDate, source: source || 'all' },
      'Webhook events replayed in range',
    );

    res.json({ replayed: true, count });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to replay webhook range');
    res.status(500).json({ error: 'Failed to replay webhook events in range' });
  }
});

export { router as adminWebhooksRouter };
