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
      data: runs,
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

    res.json(run);
  } catch (err) {
    log.error({ err: String(err), runId: req.params.id }, 'Failed to fetch run');
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

export { router as runsApiRouter };
