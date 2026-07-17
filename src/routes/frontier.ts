import { Router, type Request, type Response } from 'express';
import { getFrontierStatus, getScoreHistory, getTaskScore, resetScores } from '../frontier/score.js';
import { getRunningTasks, abortTask } from '../frontier/harness.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'frontier-routes' });

const router: Router = Router();

router.get('/status', (_req: Request, res: Response) => {
  try {
    const status = getFrontierStatus();
    const running = getRunningTasks();
    res.json({ status, running });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get frontier status');
    res.status(500).json({ error: 'Failed to get frontier status' });
  }
});

router.get('/history', (_req: Request, res: Response) => {
  try {
    const history = getScoreHistory();
    res.json({ history });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get frontier history');
    res.status(500).json({ error: 'Failed to get frontier history' });
  }
});

router.get('/tasks/:id', (req: Request, res: Response) => {
  try {
    const entry = getTaskScore(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ task: entry });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get task score');
    res.status(500).json({ error: 'Failed to get task score' });
  }
});

router.post('/reset', (_req: Request, res: Response) => {
  try {
    resetScores();
    res.json({ reset: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to reset scores');
    res.status(500).json({ error: 'Failed to reset scores' });
  }
});

router.get('/running', (_req: Request, res: Response) => {
  try {
    const running = getRunningTasks();
    res.json({ running });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get running tasks');
    res.status(500).json({ error: 'Failed to get running tasks' });
  }
});

router.post('/abort/:id', (req: Request, res: Response) => {
  try {
    const aborted = abortTask(req.params.id);
    res.json({ aborted });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to abort task');
    res.status(500).json({ error: 'Failed to abort task' });
  }
});

export { router as frontierRouter };
