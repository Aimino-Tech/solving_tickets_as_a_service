/**
 * Linear Webhook Handler — validates, extracts context, and queues issues.
 *
 * This is the primary entry point for incoming Linear webhook events.
 * It re-exports and builds upon the lower-level infrastructure in
 * src/trackers/linear.ts, adding:
 *
 * 1. Express middleware integration for /webhook/linear
 * 2. Structured issue context extraction from webhook payloads
 * 3. Automatic queueing via BullMQ (with source = 'linear' context)
 * 4. Webhook event logging via WebhookEventsRepository for audit
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *   import { linearWebhookRouter } from './tracker/linearWebhookHandler.js';
 *   app.use(linearWebhookRouter);
 *
 *   // Or use the handler function directly:
 *   import { handleLinearWebhookEvent } from './tracker/linearWebhookHandler.js';
 *   app.post('/webhook/linear', handleLinearWebhookEvent);
 * ──────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { LinearTracker, verifyLinearWebhookSignature } from '../trackers/linear.js';
import { config } from '../config.js';
import { getTracker } from '../trackers/index.js';
import { getOctokit } from '../github/auth.js';
import { QUEUES, publishMessage, connect as rmqConnect, isConnected } from '../queue/rabbitmq.js';
import { logWebhookReceived, logWebhookProcessed, logWebhookFailed } from '../webhooks/eventLogger.js';
import { recordWebhookDuration, recordWebhookReceived } from '../webhooks/metrics.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';

const log = rootLogger.child({ module: 'linear-webhook-handler' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinearWebhookContext {
  /** The Linear issue ID extracted from the webhook payload. */
  ticketId: string;
  /** The webhook action type: 'create' | 'update' | 'delete'. */
  action: string;
  /** The event type from the Linear webhook header (e.g. 'Issue', 'Comment'). */
  eventType: string | undefined;
  /** The delivery ID for idempotency (linear-delivery header). */
  deliveryId: string | undefined;
  /** The raw parsed payload for audit logging. */
  payload: Record<string, unknown>;
}

export interface ExtractedIssueContext {
  /** Linear issue ID. */
  ticketId: string;
  /** Issue title. */
  title: string;
  /** Issue description/body. */
  description: string | null;
  /** Current state (workflow status). */
  status: string;
  /** Priority level (0-4, where 1=urgent in Linear). */
  priority: number;
  /** Issue labels. */
  labels: string[];
  /** Linear issue URL. */
  url: string;
  /** Team key (e.g. 'SYNTARO', 'ENG'). */
  teamKey: string | null;
  /** Project name, if any. */
  projectName: string | null;
}

// ---------------------------------------------------------------------------
// Express Router
// ---------------------------------------------------------------------------

export const linearWebhookRouter: Router = Router();

/**
 * POST /webhook/linear
 *
 * Receives Linear webhook events, validates the signature, extracts issue
 * context, logs the event for audit, and queues the issue for processing.
 *
 * Accept headers:
 *   linear-signature  — HMAC-SHA256 signature for verification
 *   linear-delivery   — unique delivery ID for idempotency
 *   linear-event      — event type (Issue, Comment, etc.)
 */
linearWebhookRouter.post('/webhook/linear', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const rawBody = (req as { rawBody?: Buffer }).rawBody;
  const source = 'linear';
  const signature = req.headers['linear-signature'] as string | undefined;
  const deliveryId = req.headers['linear-delivery'] as string | undefined;
  const eventType = req.headers['linear-event'] as string | undefined;

  let eventId: number | undefined;

  try {
    // Validate raw body
    if (!rawBody) {
      res.status(400).json({ error: 'missing raw body' });
      return;
    }

    // Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'invalid JSON payload' });
      return;
    }

    // Log webhook received for audit
    try {
      eventId = await logWebhookReceived({
        source,
        eventType: eventType || 'unknown',
        deliveryId,
        payload,
      });
    } catch {
      // non-fatal
    }

    // Verify webhook signature
    if (!verifyLinearWebhookSignature(rawBody, signature || '')) {
      if (eventId) await logWebhookFailed(eventId, 'signature verification failed');
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    // Extract issue context from payload
    const context = extractWebhookContext(payload, eventType);

    if (!context) {
      if (eventId) await logWebhookFailed(eventId, 'invalid webhook payload — missing data.id');
      res.status(400).json({ error: 'invalid webhook payload' });
      return;
    }

    // For create/update events, fetch full issue details and queue
    if (context.action === 'create' || context.action === 'update') {
      await processLinearIssue(context.ticketId, eventId);
    } else {
      log.info({ ticketId: context.ticketId, action: context.action }, 'Linear webhook event — no processing needed');
    }

    // Mark as processed
    if (eventId) await logWebhookProcessed(eventId);
    recordWebhookDuration(source, Date.now() - startTime);

    res.status(202).json({ accepted: true, ticketId: context.ticketId });
  } catch (err) {
    log.error({ err: String(err) }, 'Linear webhook processing failed');
    if (eventId) await logWebhookFailed(eventId, String(err));
    recordWebhookDuration(source, Date.now() - startTime);
    res.status(202).json({ accepted: true });
  }
});

// ---------------------------------------------------------------------------
// Core handler logic
// ---------------------------------------------------------------------------

/**
 * Extract issue context from a Linear webhook payload.
 * Returns null if the payload is invalid (missing data.id).
 */
export function extractWebhookContext(
  payload: Record<string, unknown>,
  _eventType?: string,
): LinearWebhookContext | null {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data?.id) {
    log.warn({ payload }, 'Invalid Linear webhook payload — missing data.id');
    return null;
  }

  const action = (payload.action as string) || 'update';

  return {
    ticketId: data.id as string,
    action,
    eventType: _eventType,
    deliveryId: undefined,
    payload,
  };
}

/**
 * Process a Linear issue: fetch full details, build IssueJobData, and enqueue.
 */
async function processLinearIssue(
  ticketId: string,
  eventId?: number,
): Promise<void> {
  const tracker = getTracker('linear') as LinearTracker | undefined;

  if (!tracker) {
    log.warn('Linear tracker not initialized — cannot process Linear webhook');
    return;
  }

  try {
    // Fetch full issue details from Linear
    const ticket = await tracker.getTicket(ticketId);
    log.info({ ticketId, title: ticket.title, status: ticket.status }, 'Fetched Linear ticket details');

    // Get GitHub repo config
    const repoOwner = config.trackers.defaultRepoOwner;
    const repoName = config.trackers.defaultRepoName;
    const installationId = config.trackers.installationId;

    if (!repoOwner || !repoName || !installationId) {
      log.warn(
        'TRACKER_DEFAULT_REPO_OWNER/NAME or TRACKER_INSTALLATION_ID not configured — Linear ticket not enqueued',
      );
      return;
    }

    // Check if issue has SYNTARO label
    const hasSyntaroLabel = ticket.labels.some(
      (l) => l.toLowerCase() === (config.syntaro.label || 'syntaro:fix').toLowerCase(),
    );

    if (!hasSyntaroLabel) {
      log.info(
        { ticketId, labels: ticket.labels },
        'Linear issue does not have SYNTARO label — skipping',
      );
      return;
    }

    // Build job data
    const jobData: IssueJobData = {
      installationId,
      repoOwner,
      repoName,
      repoPrivate: false,
      issueNumber: 0,
      issueTitle: ticket.title,
      issueBody: ticket.description,
      source: 'linear',
      trackerType: 'linear',
      trackerTicketId: ticket.id,
    };

    // Enqueue for processing via RabbitMQ
    if (!isConnected()) {
      await rmqConnect();
    }
    const messageId = `${installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
    await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
      ...jobData,
      _meta: { messageId, enqueuedAt: new Date().toISOString() },
    });
    log.info({ messageId, ticketId, title: ticket.title }, 'Linear issue enqueued for processing via RabbitMQ');
  } catch (err) {
    log.error({ err: String(err), ticketId }, 'Failed to process Linear issue');
    if (eventId) await logWebhookFailed(eventId, String(err));
  }
}

/**
 * Fetch full issue context from Linear and build the extracted context.
 * This is a convenience function for handlers that need the full issue data.
 */
export async function getIssueContext(ticketId: string): Promise<ExtractedIssueContext | null> {
  const tracker = getTracker('linear') as LinearTracker | undefined;
  if (!tracker) return null;

  try {
    const ticket = await tracker.getTicket(ticketId);
    return {
      ticketId: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      labels: ticket.labels,
      url: ticket.url,
      teamKey: null,
      projectName: null,
    };
  } catch (err) {
    log.error({ err: String(err), ticketId }, 'Failed to fetch Linear issue context');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Re-exports from the lower-level tracker for convenience
// ---------------------------------------------------------------------------

export { verifyLinearWebhookSignature } from '../trackers/linear.js';
export { LinearTracker } from '../trackers/linear.js';
