/**
 * AuditLogRepository — append-only audit log.
 *
 * Security-relevant events are recorded here and never deleted or updated.
 */

import { queryWithRetry } from '../connection.js';
import type { AuditLog, NewAuditLog } from '../schema/index.js';

export class AuditLogRepository {
  /**
   * Append an entry to the audit log.
   */
  async log(data: NewAuditLog): Promise<AuditLog> {
    const result = await queryWithRetry<AuditLog>(
      `INSERT INTO audit_logs (account_id, action, details, ip_address)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.accountId, data.action, data.details ?? null, data.ipAddress ?? null],
    );
    return result.rows[0];
  }

  /**
   * Query audit logs for an account (paginated, newest first).
   */
  async listByAccount(accountId: number, limit = 50, offset = 0): Promise<AuditLog[]> {
    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs
       WHERE account_id = $1
       ORDER BY created_at DESC
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
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [action, limit, offset],
    );
    return result.rows;
  }

  async listByActionAndAccount(action: string, accountId: number, limit = 50, offset = 0): Promise<AuditLog[]> {
    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs
       WHERE action = $1 AND account_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [action, accountId, limit, offset],
    );
    return result.rows;
  }

  /**
   * Get all audit logs within a date range.
   */
  async listByDateRange(startDate: Date, endDate: Date, limit = 100, offset = 0): Promise<AuditLog[]> {
    const result = await queryWithRetry<AuditLog>(
      `SELECT * FROM audit_logs
       WHERE created_at >= $1 AND created_at < $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [startDate.toISOString(), endDate.toISOString(), limit, offset],
    );
    return result.rows;
  }
}

export const auditLogRepository = new AuditLogRepository();
