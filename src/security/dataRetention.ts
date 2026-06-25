import { queryWithRetry } from '../db/connection.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'data-retention' });
export const RETENTION_DAYS = config.dataPrivacy.retentionDays;
export interface DeletionRequest { id: number; accountId: number; requestedAt: string; scheduledDeletionAt: string; status: 'pending' | 'completed' | 'cancelled'; }

export async function requestDataDeletion(accountId: number): Promise<DeletionRequest> {
  const scheduledDate = new Date(); scheduledDate.setDate(scheduledDate.getDate() + RETENTION_DAYS);
  const result = await queryWithRetry<DeletionRequest>(
    `INSERT INTO data_deletion_requests (account_id, requested_at, scheduled_deletion_at, status)
     VALUES ($1, NOW(), $2, 'pending')
     RETURNING id, account_id as "accountId", requested_at as "requestedAt", scheduled_deletion_at as "scheduledDeletionAt", status`,
    [accountId, scheduledDate.toISOString()],
  );
  const request = result.rows[0]; log.info({ accountId, deletionRequestId: request.id }, 'Data deletion requested'); return request;
}

export async function cancelDeletionRequest(accountId: number): Promise<boolean> {
  const result = await queryWithRetry(`UPDATE data_deletion_requests SET status = 'cancelled' WHERE account_id = $1 AND status = 'pending'`, [accountId]);
  const cancelled = (result.rowCount ?? 0) > 0; if (cancelled) log.info({ accountId }, 'Data deletion cancelled'); return cancelled;
}

export async function getDeletionStatus(accountId: number): Promise<{ activeRequest: DeletionRequest | null; retentionDays: number }> {
  const result = await queryWithRetry<DeletionRequest>(
    `SELECT id, account_id as "accountId", requested_at as "requestedAt", scheduled_deletion_at as "scheduledDeletionAt", status
     FROM data_deletion_requests WHERE account_id = $1 ORDER BY requested_at DESC LIMIT 1`,
    [accountId],
  );
  return { activeRequest: result.rows[0] ?? null, retentionDays: RETENTION_DAYS };
}

export async function processScheduledDeletions(): Promise<number> {
  const result = await queryWithRetry(`UPDATE data_deletion_requests SET status = 'completed' WHERE status = 'pending' AND scheduled_deletion_at <= NOW() RETURNING id`);
  const processed = result.rows.length;
  if (processed > 0) { log.info({ count: processed }, 'Scheduled deletions processed'); }
  return processed;
}
