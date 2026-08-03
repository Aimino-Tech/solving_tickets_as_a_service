import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Paths that remain reachable during a maintenance window: health checks,
 * auth (so logins keep working), webhooks (so events are not lost), and
 * monitoring/metrics endpoints.
 */
export const MAINTENANCE_ALLOWLIST_PREFIXES = [
  '/health',
  '/api/v1/auth',
  '/webhook',
  '/api/v1/monitoring',
  '/api/v1/status',
  '/metrics',
  '/github-app-manifest.json',
];

/**
 * Express middleware that returns 503 while maintenance mode is enabled.
 * Allowlisted paths (health, auth, webhooks, monitoring) pass through so
 * health checks and incoming webhooks keep working during the window.
 */
export function maintenanceMode(req: Request, res: Response, next: NextFunction): void {
  if (!config.maintenanceMode) {
    next();
    return;
  }

  const path = req.path;
  if (MAINTENANCE_ALLOWLIST_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) {
    next();
    return;
  }

  res.setHeader('Retry-After', '3600');
  res.status(503).json({
    error: 'Service temporarily unavailable — maintenance in progress',
    retryAfter: 3600,
  });
}
