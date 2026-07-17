import { Router, Request, Response } from 'express';
import { getQueueHealth } from '../health/queueHealth.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'health-routes' });
const healthRouter: Router = Router();

/**
 * GET /health/queue
 * Returns queue-specific health information.
 */
healthRouter.get('/health/queue', async (_req: Request, res: Response) => {
  try {
    const queueHealth = await getQueueHealth();
    res.json(queueHealth);
  } catch (err) {
    log.error({ err }, 'Queue health check failed');
    res.status(503).json({ status: 'error', error: 'Queue health check failed' });
  }
});

/**
 * GET /health/dependencies
 * Returns dependency health information.
 */
healthRouter.get('/health/dependencies', async (_req: Request, res: Response) => {
  try {
    const depsHealth = await getDependenciesHealth();
    res.json(depsHealth);
  } catch (err) {
    log.error({ err }, 'Dependencies health check failed');
    res.status(503).json({ status: 'error', error: 'Dependencies health check failed' });
  }
});

export default healthRouter;
