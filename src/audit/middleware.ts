/**
 * Audit Middleware — non-blocking fire-and-forget logging wrapper.
 *
 * Provides an Express middleware that asynchronously logs requests to the
 * audit log without blocking the request/response cycle. Includes built-in
 * retry logic for transient database failures.
 *
 * Usage:
 *   import { auditMiddleware } from './audit/middleware.js';
 *   app.use('/admin', auditMiddleware({ action: 'admin.request' }));
 *
 * @module audit/middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { auditRepository, type ActorType, type AuditLogEntry } from './repository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'audit-middleware' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// Helper: sleep
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helper: fire-and-forget with retry
// ---------------------------------------------------------------------------

async function fireAndForget(entry: AuditLogEntry, retries = MAX_RETRIES): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await auditRepository.insert(entry);
      return; // Success
    } catch (err) {
      if (attempt < retries) {
        log.warn(
          { attempt, maxRetries: retries, err: String(err), action: entry.action },
          'Audit log insert failed, retrying...',
        );
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        log.error(
          { err: String(err), action: entry.action },
          'Audit log insert failed after all retries',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface AuditMiddlewareOptions {
  /** Default actor type to use. Defaults to 'system'. */
  actorType?: ActorType;
  /** Action name to log. Required. */
  action: string;
  /** Resource type for this request. */
  resourceType?: string;
  /** Whether to extract resource ID from request params. Defaults to true. */
  extractResourceId?: boolean;
  /** Custom details extractor function. */
  detailsExtractor?: (req: Request, res: Response) => Record<string, unknown> | undefined;
}

/**
 * Create Express middleware that logs requests to the audit log.
 *
 * The middleware runs asynchronously and does NOT block the response.
 * If the database write fails, it retries up to 3 times with backoff,
 * then logs the error and gives up.
 */
export function auditMiddleware(options: AuditMiddlewareOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Capture response finish event to log after the response is sent
    res.on('finish', () => {
      const resourceId = options.extractResourceId !== false
        ? (req.params.id as string | undefined)
        : undefined;

      const details: Record<string, unknown> = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        query: req.query as Record<string, unknown>,
      };

      if (options.detailsExtractor) {
        const customDetails = options.detailsExtractor(req, res);
        if (customDetails) {
          Object.assign(details, customDetails);
        }
      }

      const entry: AuditLogEntry = {
        actorType: options.actorType ?? 'system',
        actorId: (req as Record<string, unknown>).adminId as string ?? (req as Record<string, unknown>).accountId as string,
        action: options.action,
        resourceType: options.resourceType,
        resourceId,
        details,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: req.requestId,
      };

      // Fire and forget — do not await
      fireAndForget(entry).catch((err) => {
        log.error({ err: String(err) }, 'Unexpected error in audit fire-and-forget');
      });
    });

    next();
  };
}

/**
 * Create a simple audit entry directly (for non-middleware contexts).
 * Fire-and-forget with retry.
 */
export async function auditLog(
  entry: AuditLogEntry,
): Promise<void> {
  await fireAndForget(entry);
}
