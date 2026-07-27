import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { requireAuth } from '../security/authMiddleware.js';
import { feedbackRepository } from '../db/repositories/FeedbackRepository.js';
import { runsRepository } from '../db/repositories/RunsRepository.js';
import { accountsRepository } from '../db/repositories/AccountsRepository.js';

const log = rootLogger.child({ module: 'feedback-api' });

const router: Router = Router();

router.use(requireAuth);

function getUserId(req: Request): number | undefined {
  return (req as any).userId;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { runId, rating, comment, action } = req.body;

    if (!runId || !rating) {
      res.status(400).json({ error: 'runId and rating are required' });
      return;
    }

    if (!['worked', 'not_working', 'partial'].includes(rating)) {
      res.status(400).json({ error: 'rating must be worked, not_working, or partial' });
      return;
    }

    const run = await runsRepository.findById(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const feedback = await feedbackRepository.create({
      runId,
      userId,
      rating,
      comment: comment ?? '',
      action: action ?? 'none',
    });

    if (action === 'cancel') {
      log.info({ runId, userId }, 'User cancelled run');
      await runsRepository.update(runId, { status: 'cancelled' });
    }

    log.info({ runId, userId, rating, action }, 'Feedback submitted');
    res.status(201).json({ feedback });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to submit feedback');
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

router.get('/:runId', async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const feedback = await feedbackRepository.findByRun(runId);
    res.json({ feedback });
  } catch (err) {
    log.error({ err: String(err), runId: req.params.runId }, 'Failed to fetch feedback');
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

router.post('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid feedback ID' });
      return;
    }

    await feedbackRepository.resolve(id);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to resolve feedback');
    res.status(500).json({ error: 'Failed to resolve feedback' });
  }
});

export { router as feedbackRouter };
