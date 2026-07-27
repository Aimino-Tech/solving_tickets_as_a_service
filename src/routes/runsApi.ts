import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { runsRepository } from '../db/repositories/index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'runs-api' });

const router: Router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = req.user!.accountId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.perPage) || 20), 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const runs = await runsRepository.list({
      accountId,
      status,
      limit,
      offset,
    });

    const countResult = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM runs WHERE account_id = $1',
      [userId],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    res.json({
      data: runs.map(r => ({ ...r, creditsUsed: r.creditsUsed })),
      total,
      page,
      perPage: limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.post('/:id/feedback', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    const { rating, comment, category } = req.body;
    if (!rating || !['good', 'bad', 'neutral'].includes(rating)) {
      res.status(400).json({ error: 'rating must be "good", "bad", or "neutral"' });
      return;
    }
    await queryWithRetry(
      `INSERT INTO run_feedback (run_id, account_id, rating, comment, category, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [runId, req.user!.accountId, rating, comment || null, category || null],
    );
    log.info({ runId, rating, category }, 'Run feedback recorded');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to record feedback');
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

router.post('/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }
    await queryWithRetry(
      `UPDATE runs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND account_id = $2 AND status IN ('queued', 'running')`,
      [runId, req.user!.accountId],
    );
    log.info({ runId }, 'Run cancelled by user');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to cancel run');
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json({
      ...run,
      creditsUsed: run.creditsUsed,
    });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to fetch run');
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

export { router as runsApiRouter };
