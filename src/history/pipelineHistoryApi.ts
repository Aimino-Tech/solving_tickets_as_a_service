/**
 * Pipeline History API — REST endpoints for querying pipeline run history.
 *
 * Endpoints:
 *   GET    /api/history              — Query runs with filters
 *   GET    /api/history/stats        — Aggregate run statistics
 *   GET    /api/history/export/csv   — Export runs as CSV
 *   GET    /api/history/:id          — Get single run detail
 *   POST   /api/history/retention    — Trigger retention enforcement
 *
 * Query params for list endpoint:
 *   tenant_id   — Filter by tenant (required for non-admin)
 *   status      — Filter by status (pending, running, completed, failed, cancelled)
 *   agent_type  — Filter by agent type
 *   issue_id    — Filter by issue ID
 *   date_from   — Start date (ISO 8601)
 *   date_to     — End date (ISO 8601)
 *   offset      — Pagination offset (default: 0)
 *   limit       — Page size (default: 50, max: 100)
 *
 * @module history/pipelineHistoryApi
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { rootLogger } from '../utils/logger.js';
import { pipelineRunStore } from './pipelineRunStore.js';

const log = rootLogger.child({ module: 'pipeline-history-api' });

const router: Router = Router();

const historyLimiter = (rateLimit as any)({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

router.use(historyLimiter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract tenant_id from request — from query param, header, or admin context.
 * In production, this would come from auth middleware; for now we accept a
 * query param or x-tenant-id header.
 */
function getTenantId(req: Request): string | undefined {
  return (req.query.tenant_id as string) || (req.headers['x-tenant-id'] as string) || undefined;
}

/**
 * Validate that a date string is valid ISO 8601.
 */
function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// GET /api/history — query runs with filters
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/history:
 *   get:
 *     summary: Query pipeline run history
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: agent_type
 *         schema: { type: string }
 *       - in: query
 *         name: issue_id
 *         schema: { type: string }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated list of pipeline runs
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const {
      status,
      agent_type: agentType,
      issue_id: issueId,
      date_from: dateFrom,
      date_to: dateTo,
      offset,
      limit,
    } = req.query as Record<string, string | undefined>;

    // Validate date params
    if (dateFrom && !isValidDate(dateFrom)) {
      res.status(400).json({ error: 'Invalid date_from format — use ISO 8601' });
      return;
    }
    if (dateTo && !isValidDate(dateTo)) {
      res.status(400).json({ error: 'Invalid date_to format — use ISO 8601' });
      return;
    }

    const result = await pipelineRunStore.queryRuns({
      tenantId,
      status,
      agentType,
      issueId,
      dateFrom,
      dateTo,
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.json({
      runs: result.runs,
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to query pipeline history');
    res.status(500).json({ error: 'Failed to query pipeline history' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/stats — aggregate statistics
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/history/stats:
 *   get:
 *     summary: Get aggregate pipeline run statistics
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Aggregate statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;

    if (dateFrom && !isValidDate(dateFrom)) {
      res.status(400).json({ error: 'Invalid date_from format — use ISO 8601' });
      return;
    }
    if (dateTo && !isValidDate(dateTo)) {
      res.status(400).json({ error: 'Invalid date_to format — use ISO 8601' });
      return;
    }

    const stats = await pipelineRunStore.getStats(tenantId, dateFrom, dateTo);
    res.json(stats);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch pipeline stats');
    res.status(500).json({ error: 'Failed to fetch pipeline stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/export/csv — export runs as CSV
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/history/export/csv:
 *   get:
 *     summary: Export pipeline runs as CSV
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: CSV file with pipeline run data
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get('/export/csv', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const status = req.query.status as string | undefined;
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;

    const csv = await pipelineRunStore.exportToCSV({
      tenantId,
      status,
      dateFrom,
      dateTo,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pipeline-history-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to export pipeline history');
    res.status(500).json({ error: 'Failed to export pipeline history' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:id — single run detail
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/history/{id}:
 *   get:
 *     summary: Get a single pipeline run by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Pipeline run detail with stage events
 *       404:
 *         description: Run not found
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await pipelineRunStore.getRunById(id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Also fetch stage events for detail view
    const stageEvents = await pipelineRunStore.getStageEvents(id);

    res.json({
      ...run,
      stageEvents,
    });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to fetch pipeline run');
    res.status(500).json({ error: 'Failed to fetch pipeline run' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/history/retention — trigger retention enforcement
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/history/retention:
 *   post:
 *     summary: Trigger retention policy enforcement
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               retention_days:
 *                 type: integer
 *                 default: 90
 *     responses:
 *       200:
 *         description: Retention enforcement result
 */
router.post('/retention', async (req: Request, res: Response) => {
  try {
    const retentionDays = Math.max(
      1,
      Number(req.body?.retention_days ?? 90),
    );
    const deleted = await pipelineRunStore.enforceRetention(retentionDays);
    res.json({
      deleted,
      retentionDays,
      message: `Purged ${deleted} run(s) older than ${retentionDays} days`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to enforce retention');
    res.status(500).json({ error: 'Failed to enforce retention' });
  }
});

// ---------------------------------------------------------------------------
// Fallthrough: catch nesting issues (export/csv before :id)
// ---------------------------------------------------------------------------

export { router as pipelineHistoryRouter };
