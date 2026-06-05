/**
 * WebhookEventsRepository — database access for webhook_events table.
 *
 * Provides CRUD operations plus paginated listing, filtering,
 * replay functionality, and retry scheduling for the admin API
 * and the webhook retry worker.
 */

import { queryWithRetry } from '../connection.js';
import type { WebhookEvent } from '../schema/index.js';

export interface WebhookEventsFilter {
  source?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ReplayRangeOptions {
  startDate: string;
  endDate: string;
  source?: string;
}

/**
 * Exponential backoff schedule for webhook retries.
 * Each entry is the delay in minutes from the previous attempt.
 * Index 0 = delay before 1st retry, index 1 = delay before 2nd retry, etc.
 */
export const WEBHOOK_RETRY_DELAYS_MINUTES = [1, 5, 30];
export const WEBHOOK_MAX_RETRIES = 3;

export class WebhookEventsRepository {
  /**
   * Find a webhook event by its ID.
   */
  async findById(id: number): Promise<WebhookEvent | undefined> {
    const result = await queryWithRetry<WebhookEvent>(
      'SELECT * FROM webhook_events WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  /**
   * Insert a new webhook event, returning the id.
   * If delivery_id is provided and a row with that (delivery_id, source)
   * already exists, returns the existing row id (idempotent insert).
   */
  async insert(event: {
    source: string;
    eventType: string;
    deliveryId?: string;
    payload: unknown;
  }): Promise<number> {
    const { source, eventType, deliveryId, payload } = event;

    // Check for existing delivery_id for idempotency
    if (deliveryId) {
      const existing = await queryWithRetry<{ id: number }>(
        'SELECT id FROM webhook_events WHERE delivery_id = $1 AND source = $2 LIMIT 1',
        [deliveryId, source],
      );
      if (existing.rows.length > 0) {
        return existing.rows[0].id;
      }
    }

    const payloadJson = payload !== undefined ? JSON.stringify(payload) : null;
    const result = await queryWithRetry<{ id: number }>(
      `INSERT INTO webhook_events (source, event_type, delivery_id, payload, status, created_at)
       VALUES ($1, $2, $3, $4::jsonb, 'received', NOW())
       RETURNING id`,
      [source, eventType, deliveryId || null, payloadJson],
    );

    return result.rows[0].id;
  }

  /**
   * List webhook events with optional filtering and pagination.
   */
  async list(filter: WebhookEventsFilter): Promise<{ events: WebhookEvent[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filter.source) {
      conditions.push(`source = $${paramIndex++}`);
      params.push(filter.source);
    }

    if (filter.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const countResult = await queryWithRetry<{ count: number }>(
      `SELECT COUNT(*) as count FROM webhook_events ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const dataParams = [...params, limit, offset];
    const dataResult = await queryWithRetry<WebhookEvent>(
      `SELECT * FROM webhook_events ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      dataParams,
    );

    return { events: dataResult.rows, total };
  }

  /**
   * Update event status to 'processed' after successful handling.
   */
  async markProcessed(id: number): Promise<void> {
    await queryWithRetry(
      `UPDATE webhook_events
       SET status = 'processed', processed_at = NOW(), next_retry_at = NULL
       WHERE id = $1`,
      [id],
    );
  }

  /**
   * Update event status to 'failed' and schedule next retry.
   * If max retries exhausted, marks as 'dead' instead.
   */
  async markFailed(id: number, errorMessage: string): Promise<void> {
    await queryWithRetry(
      `UPDATE webhook_events
       SET status = 'failed',
           last_error = $2,
           retry_count = retry_count + 1,
           next_retry_at = $3,
           processed_at = NOW()
       WHERE id = $1`,
      [id, errorMessage, this.computeNextRetryAt()],
    );
  }

  /**
   * Mark event as 'dead' after exhausting all retries.
   */
  async markDead(id: number, errorMessage: string): Promise<void> {
    await queryWithRetry(
      `UPDATE webhook_events
       SET status = 'dead',
           last_error = CONCAT(last_error, ' | DEAD: ', $2),
           next_retry_at = NULL,
           processed_at = NOW()
       WHERE id = $1`,
      [id, errorMessage],
    );
  }

  /**
   * Mark event as 'received' again and schedule immediate retry.
   * Used by the retry worker.
   */
  async markForRetry(id: number, errorMessage: string): Promise<void> {
    await queryWithRetry(
      `UPDATE webhook_events
       SET status = 'failed',
           last_error = $2,
           retry_count = retry_count + 1,
           next_retry_at = $3,
           processed_at = NOW()
       WHERE id = $1`,
      [id, errorMessage, this.computeNextRetryAt()],
    );
  }

  /**
   * Replay a webhook event by resetting its status to 'received'
   * so the retry worker will pick it up again.
   */
  async markForReplay(id: number): Promise<WebhookEvent | undefined> {
    const result = await queryWithRetry<WebhookEvent>(
      `UPDATE webhook_events
       SET status = 'received',
           retry_count = 0,
           last_error = NULL,
           next_retry_at = NULL,
           processed_at = NULL
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  /**
   * Replay all webhook events within a date range that match optional source filter.
   * Returns the count of events queued for replay.
   */
  async replayRange(options: ReplayRangeOptions): Promise<number> {
    const conditions: string[] = [
      'created_at >= $1',
      'created_at < $2',
    ];
    const params: unknown[] = [options.startDate, options.endDate];

    let paramIndex = 3;
    if (options.source) {
      conditions.push(`source = $${paramIndex++}`);
      params.push(options.source);
    }

    const whereClause = conditions.join(' AND ');

    const result = await queryWithRetry<{ id: number }>(
      `UPDATE webhook_events
       SET status = 'received',
           retry_count = 0,
           last_error = NULL,
           next_retry_at = NULL,
           processed_at = NULL
       WHERE ${whereClause}
       RETURNING id`,
      params,
    );

    return result.rows.length;
  }

  /**
   * Find a webhook event by delivery_id and source (for idempotency checks).
   */
  async findByDeliveryId(deliveryId: string, source: string): Promise<WebhookEvent | undefined> {
    const result = await queryWithRetry<WebhookEvent>(
      'SELECT * FROM webhook_events WHERE delivery_id = $1 AND source = $2 LIMIT 1',
      [deliveryId, source],
    );
    return result.rows[0];
  }

  /**
   * Get unique sources that have webhook events (for filter dropdowns).
   */
  async listSources(): Promise<string[]> {
    const result = await queryWithRetry<{ source: string }>(
      'SELECT DISTINCT source FROM webhook_events ORDER BY source',
    );
    return result.rows.map((r) => r.source);
  }

  /**
   * Get status distribution counts.
   */
  async statusCounts(): Promise<Record<string, number>> {
    const result = await queryWithRetry<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM webhook_events
       GROUP BY status ORDER BY status`,
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  /**
   * Find stale events that need retry processing.
   * Returns events that are:
   *   - 'received' (never picked up, older than 30s)
   *   - 'failed' with next_retry_at <= NOW()
   * Limited to batchSize to avoid overwhelming the worker.
   */
  async findStaleEvents(batchSize: number = 10): Promise<WebhookEvent[]> {
    const result = await queryWithRetry<WebhookEvent>(
      `SELECT * FROM webhook_events
       WHERE (
         (status = 'received' AND created_at < NOW() - INTERVAL '30 seconds')
         OR
         (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
       )
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );
    return result.rows;
  }

  /**
   * Update the event status when retry processing begins.
   * Sets status to 'processing' to prevent double-processing.
   */
  async markProcessing(id: number): Promise<void> {
    await queryWithRetry(
      `UPDATE webhook_events SET status = 'processing' WHERE id = $1 AND status IN ('received', 'failed')`,
      [id],
    );
  }

  /**
   * Count events by status for health monitoring.
   */
  async countByStatus(status: string): Promise<number> {
    const result = await queryWithRetry<{ count: number }>(
      'SELECT COUNT(*) as count FROM webhook_events WHERE status = $1',
      [status],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute next retry time based on current retry_count.
   * Uses exponential backoff: 1min, 5min, 30min.
   * Returns null if retry_count >= max retries (event should go to dead).
   */
  private computeNextRetryAt(retryCount?: number): string | null {
    const current = retryCount ?? 0;
    if (current >= WEBHOOK_MAX_RETRIES) return null;
    const delayMinutes = WEBHOOK_RETRY_DELAYS_MINUTES[current] ?? 30;
    const date = new Date(Date.now() + delayMinutes * 60 * 1000);
    return date.toISOString();
  }
}

export const webhookEventsRepository = new WebhookEventsRepository();
