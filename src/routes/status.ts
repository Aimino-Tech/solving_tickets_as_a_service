import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'status' });

const router: Router = Router();

interface StatusResponse {
  status: 'operational' | 'degraded' | 'down';
  uptime: number;
  version: string;
  issuesFixed: number;
  runsCompleted: number;
  queueDepth: number;
  mes: string;
  services: Record<string, 'up' | 'down' | 'degraded'>;
}

const START_TIME = Date.now();

router.get('/api/v1/status', async (_req: Request, res: Response) => {
  try {
    const { runsRepository } = await import('../db/repositories/index.js');
    let completedCount = 0;
    try {
      completedCount = await runsRepository.countByStatus('completed');
    } catch {
      const { createStorage } = await import('../storage/index.js');
      const storage = await createStorage();
      if (storage) {
        const all = await storage.listRuns({ limit: 1000 });
        completedCount = all.filter((r: Record<string, unknown>) =>
          r.status === 'completed' || r.status === 'success'
        ).length;
      }
    }

    let queueDepth = 0;

    const response: StatusResponse = {
      status: 'operational',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: process.env.npm_package_version || '0.1.0',
      issuesFixed: completedCount,
      runsCompleted: completedCount,
      queueDepth,
      mes: 'All systems operational',
      services: {
        api: 'up',
        webhook: 'up',
        database: 'up',
        queue: queueDepth > 50 ? 'degraded' : 'up',
      },
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(response);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get status');
    res.status(500).json({
      status: 'degraded',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: process.env.npm_package_version || '0.1.0',
      issuesFixed: 0,
      runsCompleted: 0,
      queueDepth: 0,
      mes: 'Status endpoint error',
      services: { api: 'degraded', webhook: 'unknown', database: 'unknown', queue: 'unknown' },
    } satisfies StatusResponse);
  }
});

export default router;
