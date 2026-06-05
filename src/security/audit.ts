/**
 * Audit logging service — fire-and-forget append-only audit trail.
 *
 * All security-relevant and system events are recorded via this service.
 * Logging is non-blocking: the DB write is dispatched asynchronously and
 * errors are caught silently (with a log warning) to avoid slowing down
 * the request path.
 */

import { auditLogRepository } from '../db/repositories/AuditLogRepository.js';
import type { AuditLog, NewAuditLog } from '../db/schema/index.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'audit-service' });

export interface AuditLogFilters {
  actorType?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class AuditService {
  private static instance: AuditService;

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  /**
   * Log an audit event — fire-and-forget (non-blocking).
   *
   * The DB write is dispatched without await so the caller is never delayed
   * by the audit log write. Errors are caught and logged only.
   */
  log(data: NewAuditLog): void {
    // Fire-and-forget: intentionally not awaited
    auditLogRepository.log(data).catch((err) => {
      log.error(
        { err: String(err), action: data.action },
        'Failed to write audit log entry (fire-and-forget)',
      );
    });
  }

  /**
   * Convenience: log an admin action.
   */
  adminAction(
    actorId: string,
    action: string,
    details?: Record<string, unknown>,
    correlationId?: string,
  ): void {
    this.log({
      actorType: 'admin',
      actorId,
      action,
      resourceType: 'admin',
      details: details ?? null,
      correlationId: correlationId ?? null,
    } as NewAuditLog);
  }

  /**
   * Convenience: log a user action.
   */
  userAction(
    actorId: string,
    action: string,
    resourceType: string,
    resourceId?: string,
    details?: Record<string, unknown>,
    correlationId?: string,
  ): void {
    this.log({
      actorType: 'user',
      actorId,
      action,
      resourceType,
      resourceId: resourceId ?? null,
      details: details ?? null,
      correlationId: correlationId ?? null,
    } as NewAuditLog);
  }

  /**
   * Convenience: log a system action.
   */
  systemAction(
    action: string,
    resourceType?: string,
    resourceId?: string,
    details?: Record<string, unknown>,
    correlationId?: string,
  ): void {
    this.log({
      actorType: 'system',
      action,
      resourceType: resourceType ?? null,
      resourceId: resourceId ?? null,
      details: details ?? null,
      correlationId: correlationId ?? null,
    } as NewAuditLog);
  }

  /**
   * Query audit logs with optional filters.
   */
  async query(filters: AuditLogFilters): Promise<{ rows: AuditLog[]; total: number }> {
    return auditLogRepository.listFiltered({
      actorType: filters.actorType,
      actorId: filters.actorId,
      action: filters.action,
      resourceType: filters.resourceType,
      resourceId: filters.resourceId,
      correlationId: filters.correlationId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      limit: filters.limit,
      offset: filters.offset,
    });
  }
}

/** Singleton instance for convenience imports. */
export const auditService = AuditService.getInstance();
