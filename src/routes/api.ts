import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { requireAuth } from '../security/authMiddleware.js';

const log = rootLogger.child({ module: 'api-routes' });

// ---------------------------------------------------------------------------
// Rate Limiting: 60 requests per minute per IP on API endpoints
// ---------------------------------------------------------------------------

const router: Router = Router();

router.use(requireAuth);

router.get('/runs', async (req: Request, res: Response) => {
  try {
    const { createStorage } = await import('../storage/index.js');
    const storage = await createStorage();
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const status = req.query.status as string | undefined;
    const repo = req.query.repo as string | undefined;
    if (!storage) { res.status(500).json({ error: 'Storage not available' }); return; }
    const runs = await storage.listRuns(limit, offset, { status, repo });
    const total = await storage.countRuns({ status, repo });
    res.json({ runs, total, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const { createStorage } = await import('../storage/index.js');
    const storage = await createStorage();
    if (!storage) { res.status(500).json({ error: 'Storage not available' }); return; }
    const run = await storage.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get run');
    res.status(500).json({ error: 'Failed to get run' });
  }
});

router.get('/repos', async (_req: Request, res: Response) => {
  try {
    const repos = config.trackers.defaultRepoOwner && config.trackers.defaultRepoName
      ? [{ owner: config.trackers.defaultRepoOwner, name: config.trackers.defaultRepoName }]
      : [];
    res.json({ repos });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list repos');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

router.post('/repos', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Repository management requires premium subscription' });
});

router.delete('/repos/:id', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Repository management requires premium subscription' });
});

router.post('/runs/:id/feedback', async (req: Request, res: Response) => {
  try {
    const runId = req.params.id;
    const { rating, comment, category } = req.body;
    if (!rating || !['good', 'bad', 'neutral'].includes(rating)) {
      res.status(400).json({ error: 'rating must be "good", "bad", or "neutral"' });
      return;
    }
    const { createStorage } = await import('../storage/index.js');
    const storage = await createStorage();
    if (!storage) { res.status(500).json({ error: 'Storage not available' }); return; }
    await storage.recordFeedback?.({ runId, rating, comment, category, userId: req.user?.accountId });
    log.info({ runId, rating, category }, 'User feedback recorded');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to record feedback');
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

router.post('/runs/:id/cancel', async (req: Request, res: Response) => {
  try {
    const runId = req.params.id;
    const { createStorage } = await import('../storage/index.js');
    const storage = await createStorage();
    if (!storage) { res.status(500).json({ error: 'Storage not available' }); return; }
    await storage.updateRunStatus?.(runId, 'cancelled');
    log.info({ runId }, 'Run cancelled by user');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to cancel run');
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

router.post('/escalation', async (req: Request, res: Response) => {
  try {
    const { issueKey, reason, details } = req.body;
    if (!issueKey || !reason) {
      res.status(400).json({ error: 'issueKey and reason are required' });
      return;
    }
    const { dispatchEscalation } = await import('../escalation/index.js');
    const result = await dispatchEscalation({
      level: 'warning',
      channel: 'slack',
      title: `User escalation: ${reason.slice(0, 100)}`,
      message: `User requested escalation for ${issueKey}.\nReason: ${reason}\nDetails: ${details ? JSON.stringify(details) : 'N/A'}`,
      issueKey,
    });
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to handle escalation request');
    res.status(500).json({ error: 'Failed to handle escalation request' });
  }
});

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const { createStorage } = await import('../storage/index.js');
    const storage = await createStorage();
    if (!storage) { res.status(500).json({ error: 'Storage not available' }); return; }
    const totalRuns = await storage.countRuns({});
    const successfulRuns = await storage.countRuns({ status: 'success' });
    const failedRuns = await storage.countRuns({ status: 'failed' });
    const passRate = totalRuns > 0 ? ((successfulRuns / totalRuns) * 100).toFixed(1) : '0.0';
    res.json({
      totalRuns,
      successfulRuns,
      failedRuns,
      passRate: `${passRate}%`,
      avgDuration: null,
      activeRepos: config.trackers.defaultRepoOwner ? 1 : 0,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get stats');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export { router as apiRouter };
