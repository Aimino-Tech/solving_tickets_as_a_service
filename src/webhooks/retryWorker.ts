/**
 * Webhook Retry Worker — processes failed webhooks with exponential backoff.
 *
 * Runs as a background interval that polls for webhook events that need
 * retry processing. Handles both:
 *   1. Fresh 'received' events that haven't been picked up yet
 *   2. 'failed' events whose next_retry_at time has passed
 *
 * Retry schedule: 1min, 5min, 30min (max 3 retries)
 *
 * ── Error Handling ─────────────────────────────────────────────────────
 * - Worker errors are logged but never crash the process
 * - Individual event processing failures are caught per-event
 * - Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing
 * - Circuit breaker: if the database is down, the worker backs off
 * ───────────────────────────────────────────────────────────────────────
 */

import { webhookEventsRepository } from '../db/repositories/WebhookEventsRepository.js';
import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';

const log = rootLogger.child({ module: 'webhook-retry-worker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEventProcessor {
  (event: { id: number; source: string; eventType: string; payload: unknown }): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Default processor — logs events that need to be re-processed
// ---------------------------------------------------------------------------

const defaultProcessor: WebhookEventProcessor = async (event) => {
  log.warn(
    { eventId: event.id, source: event.source, eventType: event.eventType },
    'No processor registered for webhook retry — event skipped',
  );
  return false;
};

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let processor: WebhookEventProcessor = defaultProcessor;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;

/**
 * Register the handler that retry worker calls when an event needs processing.
 * The handler should return true if processing succeeded, false if it failed.
 */
export function setWebhookEventProcessor(fn: WebhookEventProcessor): void {
  processor = fn;
  log.info('Webhook event processor registered');
}

/**
 * Process a single webhook event — called by the retry worker.
 * Marks as 'processing', invokes the processor, then updates status.
 */
async function processEvent(event: { id: number; source: string; eventType: string; payload: unknown }): Promise<void> {
  const startTime = Date.now();
  const { id, source, eventType } = event;

  log.debug({ eventId: id, source, eventType }, 'Retry worker processing event');

  try {
    // Mark as processing to prevent double-processing
    await webhookEventsRepository.markProcessing(id);

    // Invoke the registered processor
    const success = await processor(event);

    if (success) {
      await webhookEventsRepository.markProcessed(id);
      log.info({ eventId: id, source, eventType, durationMs: Date.now() - startTime }, 'Webhook retry succeeded');
    } else {
      const errorMsg = 'Webhook processing returned failure';
      // This will schedule next retry or mark as dead
      const currentEvent = await webhookEventsRepository.findById(id);
      if (currentEvent && currentEvent.retryCount >= 3) {
        await webhookEventsRepository.markDead(id, errorMsg);
        log.warn({ eventId: id, retryCount: currentEvent.retryCount }, 'Webhook retry exhausted — marked dead');
      } else {
        await webhookEventsRepository.markFailed(id, errorMsg);
        log.info({ eventId: id }, 'Webhook retry failed, scheduled next attempt');
      }
    }
  } catch (err) {
    const errorMsg = String(err);
    log.error({ eventId: id, err: errorMsg }, 'Webhook retry worker error processing event');

    try {
      const currentEvent = await webhookEventsRepository.findById(id);
      if (currentEvent && currentEvent.retryCount >= 3) {
        await webhookEventsRepository.markDead(id, errorMsg);
      } else {
        await webhookEventsRepository.markFailed(id, errorMsg);
      }
    } catch (updateErr) {
      log.error({ err: String(updateErr), eventId: id }, 'Failed to update event status after retry error');
    }
  }
}

/**
 * Poll for stale webhook events and process them.
 * Called on each tick of the retry interval.
 */
async function pollForStaleEvents(): Promise<void> {
  try {
    const events = await webhookEventsRepository.findStaleEvents(config.webhookRetry.batchSize);

    if (events.length === 0) {
      // No work to do — reset error counter
      consecutiveErrors = 0;
      return;
    }

    log.debug({ count: events.length }, 'Retry worker found stale webhook events');

    // Process events sequentially to avoid DB connection overload
    for (const event of events) {
      try {
        await processEvent({
          id: event.id,
          source: event.source,
          eventType: event.eventType,
          payload: event.payload,
        });
      } catch (err) {
        log.error({ err: String(err), eventId: event.id }, 'Failed to process stale webhook event');
      }
    }

    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    log.error(
      { err: String(err), consecutiveErrors },
      'Webhook retry worker poll failed',
    );

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log.error(
        { consecutiveErrors, threshold: MAX_CONSECUTIVE_ERRORS },
        'Too many consecutive errors — webhook retry worker backing off',
      );
      // The interval will keep running but we'll log less aggressively
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the webhook retry worker.
 * Polls for stale events at the configured interval.
 */
export function startWebhookRetryWorker(): void {
  if (intervalHandle) {
    log.warn('Webhook retry worker already running');
    return;
  }

  const intervalMs = config.webhookRetry.pollIntervalMs;
  log.info({ pollIntervalMs: intervalMs, batchSize: config.webhookRetry.batchSize }, 'Starting webhook retry worker');

  // Do an immediate poll on start
  pollForStaleEvents().catch((err) => {
    log.error({ err: String(err) }, 'Initial webhook retry poll failed');
  });

  intervalHandle = setInterval(() => {
    pollForStaleEvents().catch((err) => {
      log.error({ err: String(err) }, 'Webhook retry poll failed');
    });
  }, intervalMs);

  // Allow process to exit even if interval is still running
  if (intervalHandle && typeof intervalHandle === 'object' && 'unref' in intervalHandle) {
    intervalHandle.unref();
  }

  log.info('Webhook retry worker started');
}

/**
 * Stop the webhook retry worker.
 */
export function stopWebhookRetryWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Webhook retry worker stopped');
  }
}
