/**
 * AuditLogRepository — append-only audit log (enriched schema).
 *
 * Security-relevant and system events are recorded here.
 * Uses the enriched schema with actor_type, actor_id, resource_type, etc.
 */

import { queryWithRetry } from '../connection.js';
import type { AuditLog, NewAuditLog } from '../schema/index.js';

export interface AuditLogFilter {
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

export class AuditLogRepository {
  /**
   * Append an entry to the audit log.
   */
  async log(data: NewAuditLog): Promise<AuditLog> {
    const result = await queryWithRetry<AuditLog>(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource_type, resource_id, details, ip_address, user_agent, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING *`,
      [
        data.actorType ?? 'system',
        data.actorId ?? null,
        data.action,
        data.resourceType ?? null,
        data.resourceId ?? null,
        data.details ? JSON.stringify(data.details) : null,
        data.ipAddress ?? null,
        data.userAgent ?? null,
        data.correlationId ?? null,
      ],
    );
    return result.rows[0];
  }

  /**
   * Query audit logs with optional filters (paginated, newest first).
   */
  async listFiltered(filters: AuditLogFilter = {}): Promise<{ rows: AuditLog[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (filters.actorType) {
      conditions.push(`actor_type = $${paramIdx++}`);
      values.push(filters.actorType);
    }
    if (filters.actorId) {
      conditions.push(`actor_id = $${paramIdx++}`);
      values.push(filters.actorId);
    }
    if (filters.action) {
      conditions.push(`action = $${paramIdx++}`);
      values.push(filters.action);
    }
    if (filters.resourceType) {
      conditions.push(`resource_type = $${paramIdx++}`);
      values.push(filters.resourceType);
    }
    if (filters.resourceId) {
      conditions.push(`resource_id = $${paramIdx++}`);
      values.push(filters.resourceId);
    }
    if (filters.startDate) {
      conditions.push(`timestamp >= $${paramIdx++}`);
      values.push(filters.startDate.toISOString());
    }
    if (filters.endDate) {
      conditions.push(`timestamp < $${paramIdx++}`);
      values.push(filters.endDate.toISOString());
    }
    if (filters.correlationId) {
      conditions.push(`correlation_id = $${paramIdx++}`);
      values.push(filters.correlationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM audit_logs ${where}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    );

    return { rows: result.rows, total };
  }

  /**
   * Query audit logs for an account (paginated, newest first).
   */
  async listByAccount(accountId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs
       WHERE actor_id = $1 AND actor_type = 'user'
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );
    return result.rows;
  }

  /**
   * Query audit logs by action type.
   */
  async listByAction(action: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs
       WHERE action = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [action, limit, offset],
    );
    return result.rows;
  }

  /**
   * Get all audit logs within a date range.
   */
  async listByDateRange(startDate: Date, endDate: Date, limit = 100, offset = 0): Promise<AuditLog[]> {
    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs
       WHERE timestamp >= $1 AND timestamp < $2
       ORDER BY timestamp DESC
       LIMIT $3 OFFSET $4`,
      [startDate.toISOString(), endDate.toISOString(), limit, offset],
    );
    return result.rows;
  }
}

export const auditLogRepository = new AuditLogRepository();
