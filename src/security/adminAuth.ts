import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'admin-auth' });

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    res.status(503).json({ error: 'Admin API not configured' });
    return;
  }

  const provided = req.headers['x-admin-key'] as string || req.headers.authorization?.replace('Bearer ', '');
  if (!provided || provided !== adminKey) {
    log.warn({ ip: req.ip, path: req.path }, 'Unauthorized admin access attempt');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
