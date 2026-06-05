/**
 * Webhook Event Logger — persists webhook events to the database.
 *
 * Logs every received webhook BEFORE processing, then updates status
 * AFTER processing (or on failure). Supports idempotency via delivery_id.
 *
 * ── Usage ──────────────────────────────────────────────────────────────
 *   import { logWebhookReceived, logWebhookProcessed, logWebhookFailed } from './eventLogger.js';
 *
 *   // When webhook arrives
 *   const eventId = await logWebhookReceived({ source, eventType, deliveryId, payload });
 *
 *   // After processing succeeds
 *   await logWebhookProcessed(eventId);
 *
 *   // If processing fails
 *   await logWebhookFailed(eventId, errorMessage);
 * ────────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';
import { webhookEventsRepository } from '../db/repositories/WebhookEventsRepository.js';
import { recordWebhookReceived, recordWebhookProcessed, recordWebhookDuration } from './metrics.js';

const log = rootLogger.child({ module: 'webhook-event-logger' });

export interface WebhookLogEntry {
  source: string;
  eventType: string;
  deliveryId?: string;
  installationId?: string;
  repo?: string;
  rawBodySnippet?: string;
  headers?: Record<string, string>;
  payload: unknown;
}

/**
 * Log a webhook event as 'received' in the database.
 * Returns the id of the inserted row for later status updates.
 * If a delivery_id is provided and already exists, returns undefined
 * (idempotent — duplicate delivery IDs are silently skipped).
 */
export async function logWebhookReceived(entry: WebhookLogEntry): Promise<number | undefined> {
  const { source, eventType, deliveryId, installationId, repo, rawBodySnippet, headers } = entry;

  try {
    const id = await webhookEventsRepository.insert({
      source,
      eventType,
      deliveryId,
      installationId,
      repo,
      rawBodySnippet,
      headers,
      payload: entry.payload,
    });

    // Track metrics
    recordWebhookReceived(source);

    log.debug({ eventId: id, source, eventType, deliveryId }, 'Webhook event logged as received');
    return id;
  } catch (err) {
    log.error(
      { err: String(err), source, eventType, deliveryId },
      'Failed to insert webhook event into database',
    );
    // Don't throw — the webhook should still be processed even if logging fails
    return undefined;
  }
}

/**
 * Update a webhook event status to 'processed' after successful handling.
 * Also sets processed_at timestamp.
 */
export async function logWebhookProcessed(eventId: number): Promise<void> {
  if (!eventId) return;

  try {
    await webhookEventsRepository.markProcessed(eventId);
    recordWebhookProcessed('processed');
    log.debug({ eventId }, 'Webhook event marked as processed');
  } catch (err) {
    log.warn({ err: String(err), eventId }, 'Failed to update webhook event as processed');
  }
}

/**
 * Update a webhook event status to 'failed' with error details.
 * Schedules the next retry based on exponential backoff.
 */
export async function logWebhookFailed(eventId: number, errorMessage: string): Promise<void> {
  if (!eventId) return;

  try {
    // Check current retry count to decide between failed and dead
    const event = await webhookEventsRepository.findById(eventId);
    if (!event) {
      log.warn({ eventId }, 'Event not found for failed status update');
      return;
    }

    if (event.retryCount >= 3) {
      // Max retries exhausted — mark as dead
      await webhookEventsRepository.markDead(eventId, errorMessage);
      recordWebhookProcessed('dead');
      log.warn({ eventId, retryCount: event.retryCount, error: errorMessage }, 'Webhook event marked as dead');
    } else {
      // Schedule retry with backoff
      await webhookEventsRepository.markFailed(eventId, errorMessage);
      recordWebhookProcessed('failed');
      log.info(
        { eventId, retryCount: event.retryCount + 1, error: errorMessage },
        'Webhook event marked as failed, retry scheduled',
      );
    }
  } catch (err) {
    log.warn({ err: String(err), eventId }, 'Failed to update webhook event as failed');
  }
}

/**
 * Update a webhook event status to 'dead' after exhausting all retries.
 */
export async function logWebhookDead(eventId: number, errorMessage: string): Promise<void> {
  if (!eventId) return;

  try {
    await webhookEventsRepository.markDead(eventId, errorMessage);
    recordWebhookProcessed('dead');
    log.warn({ eventId, error: errorMessage }, 'Webhook event marked as dead');
  } catch (err) {
    log.warn({ err: String(err), eventId }, 'Failed to mark webhook event as dead');
  }
}
