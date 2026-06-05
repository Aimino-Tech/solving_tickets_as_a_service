/**
 * Audit Repository — append-only operations for the audit log.
 *
 * IMPORTANT: This repository only supports INSERT and SELECT operations.
 * No DELETE or UPDATE is permitted on the audit_logs table.
 *
 * @module audit/repository
 */

import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'audit-repository' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActorType = 'system' | 'admin' | 'user' | 'webhook';

export interface AuditLogEntry {
  actorType: ActorType;
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface AuditLogRow extends AuditLogEntry {
  id: number;
  timestamp: Date;
}

export interface AuditLogFilter {
  actorType?: ActorType;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class AuditRepository {
  /**
   * Insert a new audit log entry.
   * Returns the created row.
   */
  async insert(entry: AuditLogEntry): Promise<AuditLogRow> {
    const result = await queryWithRetry<AuditLogRow>(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource_type, resource_id, details, ip_address, user_agent, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING *`,
      [
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.resourceType ?? null,
        entry.resourceId ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
        entry.correlationId ?? null,
      ],
    );
    return result.rows[0];
  }

  /**
   * Query audit logs with optional filters.
   * Results are ordered by timestamp descending (newest first).
   */
  async query(filters: AuditLogFilter = {}): Promise<{ rows: AuditLogRow[]; total: number }> {
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

    // Count total matching rows
    const countResult = await queryWithRetry<{ total: number }>(
      `SELECT COUNT(*) as total FROM audit_logs ${where}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    // Fetch paginated results
    const result = await queryWithRetry<AuditLogRow>(
      `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    );

    return { rows: result.rows, total };
  }

  /**
   * Get a single audit log entry by ID.
   */
  async findById(id: number): Promise<AuditLogRow | undefined> {
    const result = await queryWithRetry<AuditLogRow>('SELECT * FROM audit_logs WHERE id = $1', [id]);
    return result.rows[0];
  }

  /**
   * Delete audit log entries older than the given retention period.
   * This is the ONLY delete operation permitted and is called by a
   * maintenance job, not by application code.
   */
  async deleteOlderThan(retentionDays: number): Promise<number> {
    const result = await queryWithRetry(
      `DELETE FROM audit_logs WHERE timestamp < NOW() - INTERVAL '1 day' * $1`,
      [retentionDays],
    );
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      log.info({ deleted, retentionDays }, 'Purged old audit log entries');
    }
    return deleted;
  }
}

export const auditRepository = new AuditRepository();
