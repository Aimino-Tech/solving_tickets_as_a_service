import type { Request, Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'governance-error' });

const GOVERNANCE_PROXY_HEADER = 'x-governance-proxy';

export function isBehindGovernanceProxy(req: Request): boolean {
  return !!req.headers[GOVERNANCE_PROXY_HEADER];
}

export interface GovernanceError {
  code: string;
  message: string;
  details: unknown;
  correlation_id: string | null;
}

export function formatError(
  code: string,
  message: string,
  details: unknown = null,
  correlationId?: string | null,
): GovernanceError {
  return {
    code,
    message,
    details,
    correlation_id: correlationId || null,
  };
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details: unknown = null,
  correlationId?: string,
): void {
  const error = formatError(code, message, details, correlationId);
  res.status(statusCode).json({ error });
}

export function sendInternalError(res: Response, correlationId?: string): void {
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error', null, correlationId);
}

export function sendNotFound(res: Response, message = 'Not found', correlationId?: string): void {
  sendError(res, 404, 'NOT_FOUND', message, null, correlationId);
}

export function sendValidationError(
  res: Response,
  message: string,
  details: unknown = null,
  correlationId?: string,
): void {
  sendError(res, 400, 'VALIDATION_ERROR', message, details, correlationId);
}

export function sendAuthError(res: Response, message = 'Authentication required', correlationId?: string): void {
  sendError(res, 401, 'AUTH_ERROR', message, null, correlationId);
}

export function sendForbidden(res: Response, message = 'Forbidden', correlationId?: string): void {
  sendError(res, 403, 'FORBIDDEN', message, null, correlationId);
}

export function globalErrorHandler(err: Error, req: Request, res: Response): void {
  log.error({ err: String(err) }, 'Unhandled error');
  const correlationId = req.requestId;
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error', String(err), correlationId);
}
