import { Router, type Request, type Response } from 'express';
import { monitoringLoop } from '../loops/monitoringLoop.js';

const router: Router = Router();

router.get('/monitoring/status', (_req: Request, res: Response) => {
  const stats = monitoringLoop?.getStats();
  if (!stats) {
    res.json({ status: 'not_started' });
    return;
  }
  res.json({
    status: stats.enabled ? (stats.running ? 'running' : 'idle') : 'disabled',
    ...stats,
  });
});

export { router };
export { router as monitoringStatusRouter };
