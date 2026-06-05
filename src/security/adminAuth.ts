/**
 * Admin endpoint authentication middleware.
 *
 * Protects admin routes (/admin/*) behind a shared API key.
 * The key is configured via the ADMIN_API_KEY environment variable.
 *
 * Usage:
 *   ```ts
 *   import { adminAuthMiddleware } from './security/adminAuth.js';
 *   app.use('/admin', adminAuthMiddleware);
 *   ```
 *
 * In production, this should be used with HTTPS and a strong, randomly
 * generated API key. For additional security, pair with an IP allowlist
 * or a reverse proxy that handles authentication before requests reach
 * the Express app.
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'admin-auth' });

/**
 * Express middleware that checks for a valid admin API key.
 *
 * The key is expected in one of:
 *   - `Authorization: Bearer <key>` header
 *   - `x-admin-key: <key>` header
 *
 * Responds with 401 if the key is missing or invalid.
 * Responds with 500 if ADMIN_API_KEY is not configured.
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const adminKey = config.security.adminApiKey;

  if (!adminKey) {
    log.error('ADMIN_API_KEY is not configured — admin routes are disabled');
    res.status(500).json({ error: 'Admin API not configured' });
    return;
  }

  // Check Authorization header first (Bearer token), then x-admin-key header
  const authHeader = req.headers.authorization || '';
  const adminKeyHeader = (req.headers['x-admin-key'] as string) || '';

  let providedKey = '';
  if (authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  } else if (adminKeyHeader) {
    providedKey = adminKeyHeader.trim();
  }

  if (!providedKey) {
    res.status(401).json({ error: 'Missing admin API key. Provide via Authorization: Bearer <key> or x-admin-key header.' });
    return;
  }

  if (providedKey !== adminKey) {
    log.warn({ ip: req.ip, path: req.path }, 'Invalid admin API key attempt');
    res.status(401).json({ error: 'Invalid admin API key' });
    return;
  }

  next();
}
