import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { isMaintenanceMode } from '../monitoring/maintenance.js';

/**
 * Paths that remain reachable during a maintenance window: health checks,
 * auth (so logins keep working), webhooks (so events are not lost),
 * monitoring/metrics endpoints, and the ops/privacy/gdpr APIs (so the window
 * can be ended and erasure requests still honored).
 */
export const MAINTENANCE_ALLOWLIST_PREFIXES = [
  '/health',
  '/api/v1/auth',
  '/webhook',
  '/api/v1/monitoring',
  '/api/v1/status',
  '/api/v1/ops',
  '/api/v1/privacy',
  '/api/v1/gdpr',
  '/metrics',
  '/github-app-manifest.json',
];

/**
 * Express middleware that returns 503 while maintenance mode is enabled.
 * The gate is active when either the runtime maintenance mode (toggled via
 * PUT /api/v1/ops/maintenance) or the static config flag is set. Allowlisted
 * paths pass through so health checks and incoming webhooks keep working.
 */
export function maintenanceMode(req: Request, res: Response, next: NextFunction): void {
  if (!config.maintenanceMode && !isMaintenanceMode()) {
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
