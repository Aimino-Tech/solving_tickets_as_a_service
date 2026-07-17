import { Router, Request, Response } from 'express';
import { getQueueHealth } from '../health/queueHealth.js';
import { getDependenciesHealth } from '../health/dependencies.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'health-routes' });
const healthRouter: Router = Router();

/**
 * GET /health
 * Returns overall service health status.
 */
healthRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const [queueHealth, depsHealth] = await Promise.all([
      getQueueHealth().catch(() => null),
      getDependenciesHealth().catch(() => null),
    ]);

    const status = depsHealth?.status === 'ok' && queueHealth ? 'ok' : 'degraded';

    res.json({
      status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      queue: queueHealth
        ? { depth: queueHealth.summary.totalMessages, status: queueHealth.status }
        : { status: 'unknown' },
      dependencies: depsHealth?.dependencies?.map((d) => ({
        name: d.name,
        status: d.status,
        latencyMs: d.latencyMs,
      })) ?? [],
    });
  } catch (err) {
    log.error({ err }, 'Health check failed');
    res.status(503).json({ status: 'error', error: 'Health check failed' });
  }
});

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
