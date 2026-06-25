import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { requireAuth } from '../security/authMiddleware.js';

const log = rootLogger.child({ module: 'agent-api' });

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

const router = Router();

router.use(apiLimiter);
router.use(requireAuth);

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'stas-agent-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.post('/pipeline/trigger', async (req: Request, res: Response) => {
  try {
    const { issue_id, pipeline_name } = req.body;
    if (!issue_id) {
      res.status(400).json({ error: 'issue_id is required' });
      return;
    }
    const { getEngine } = await import('../../workers/orchestrator/engine.js');
    const engine = getEngine();
    const pipelineId = engine.start_pipeline(issue_id, pipeline_name || 'default');
    res.status(201).json({ pipeline_id: pipelineId, issue_id, status: 'started' });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to trigger pipeline');
    res.status(500).json({ error: 'Failed to trigger pipeline' });
  }
});

router.get('/pipeline/:issue_id', async (req: Request, res: Response) => {
  try {
    const { issue_id } = req.params;
    const { getEngine } = await import('../../workers/orchestrator/engine.js');
    const engine = getEngine();
    const status = engine.get_status(issue_id);
    res.json({ issue_id, status });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get pipeline status');
    res.status(500).json({ error: 'Failed to get pipeline status' });
  }
});

router.post('/pipeline/:issue_id/cancel', async (req: Request, res: Response) => {
  try {
    const { issue_id } = req.params;
    const { getEngine } = await import('../../workers/orchestrator/engine.js');
    const engine = getEngine();
    engine.cancel_pipeline(issue_id);
    res.json({ issue_id, status: 'cancelled' });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to cancel pipeline');
    res.status(500).json({ error: 'Failed to cancel pipeline' });
  }
});

router.get('/sandbox/status', (_req: Request, res: Response) => {
  res.json({
    provider: config.e2b.apiKey ? 'e2b' : 'docker',
    available: true,
  });
});

router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { issue, limit: limitStr } = req.query;
    const limit = Math.min(Math.abs(Number(limitStr) || 50), 200);
    const { createStorage } = await import('../storage/index.js');
    const storage = await createStorage();
    if (!storage) {
      res.status(500).json({ error: 'Storage not available' });
      return;
    }
    const runs = await storage.listRuns(limit, 0, { issue: issue as string | undefined });
    res.json({ runs, total: runs.length });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to query audit');
    res.status(500).json({ error: 'Failed to query audit' });
  }
});

router.get('/queue/status', async (_req: Request, res: Response) => {
  try {
    const { getQueueHealth } = await import('../health/queueHealth.js');
    const report = await getQueueHealth();
    res.json(report);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get queue status');
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

router.get('/verify/:run_id', (req: Request, res: Response) => {
  res.json({ run_id: req.params.run_id, status: 'pending' });
});

router.post('/review/:run_id/approve', (req: Request, res: Response) => {
  const { run_id } = req.params;
  log.info({ run_id }, 'Review approved');
  res.json({ run_id, status: 'approved' });
});

export { router as agentApiRouter };
