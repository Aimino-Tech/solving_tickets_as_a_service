/**
 * Linear webhook route -- receives issue-update events from Linear and
 * queues them for STAS processing.
 *
 * --- Endpoint -----------------------------------------------------------
 * POST /api/webhooks/linear  -- Receive Linear webhook (issue-updated)
 * -------------------------------------------------------------------------
 *
 * The handler:
 * 1. Verifies the Linear webhook HMAC-SHA256 signature.
 * 2. Parses the ``issue-updated`` / ``issue-created`` event payload.
 * 3. Fetches the full ticket details from the Linear API.
 * 4. Enqueues the issue to the triage queue for processing.
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { getTracker } from '../trackers/index.js';
import { rootLogger } from '../utils/logger.js';
import {
  logWebhookReceived,
  logWebhookProcessed,
  logWebhookFailed,
} from '../webhooks/eventLogger.js';
import { createIssueQueue, enqueueIssue } from '../queue/issueQueue.js';
import type { IssueJobData } from '../utils/types.js';

const log = rootLogger.child({ module: 'linear-webhook' });

// ---------------------------------------------------------------------------
// Rate Limiting: 30 requests per minute on Linear webhook endpoint
// ---------------------------------------------------------------------------

const router = Router();


// ---------------------------------------------------------------------------
// POST /api/webhooks/linear
// ---------------------------------------------------------------------------

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const signature = req.headers['linear-signature'] as string;
  const rawBody = (req as { rawBody?: Buffer }).rawBody;
  const source = 'linear';

  if (!rawBody) {
    res.status(400).json({ error: 'Missing raw body' });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // Log the webhook event BEFORE processing
  const eventId = await logWebhookReceived({
    source,
    eventType:
      ((payload as Record<string, unknown>)?.type as string) || 'unknown',
    deliveryId: undefined,
    payload,
  });

  // Verify webhook signature
  if (!verifySignature(rawBody, signature)) {
    if (eventId) await logWebhookFailed(eventId, 'Signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Only process issue-created and issue-updated events
  const eventType = (payload as Record<string, unknown>)?.type as string;
  if (eventType !== 'Issue' && eventType !== 'issue') {
    log.debug({ eventType }, 'Ignoring non-issue Linear webhook event');
    if (eventId) await logWebhookProcessed(eventId);
    res
      .status(200)
      .json({ accepted: true, ignored: true, reason: 'not an issue event' });
    return;
  }

  const action = (payload as Record<string, unknown>)?.action as string;
  if (action !== 'create' && action !== 'update') {
    log.debug({ action }, 'Ignoring non-create/update Linear webhook event');
    if (eventId) await logWebhookProcessed(eventId);
    res
      .status(200)
      .json({
        accepted: true,
        ignored: true,
        reason: 'not create/update action',
      });
    return;
  }

  // Extract ticket ID from the payload data
  const data = (payload as Record<string, unknown>)?.data as
    | Record<string, unknown>
    | undefined;
  const ticketId = data?.id as string | undefined;

  if (!ticketId) {
    log.warn({ payload }, 'Linear webhook payload missing data.id');
    if (eventId) await logWebhookFailed(eventId, 'Missing data.id');
    res.status(400).json({ error: 'Invalid payload -- missing data.id' });
    return;
  }

  log.info(
    { ticketId, action, title: data?.title },
    'Linear webhook event received',
  );

  // Fetch full ticket details from the Linear API
  const tracker = getTracker('linear');
  if (!tracker) {
    log.warn(
      'Linear tracker not initialized (LINEAR_API_KEY may be missing)',
    );
    if (eventId) await logWebhookProcessed(eventId);
    res
      .status(200)
      .json({
        accepted: true,
        skipped: true,
        reason: 'Linear tracker not initialized',
      });
    return;
  }

  try {
    const ticket = await tracker.getTicket(ticketId);
    log.info(
      { ticketId, title: ticket.title },
      'Fetched Linear ticket details',
    );

    const repoOwner = config.trackers.defaultRepoOwner;
    const repoName = config.trackers.defaultRepoName;
    const installationId = config.trackers.installationId;

    if (repoOwner && repoName && installationId) {
      // Determine pipeline from labels
      const pipeline = resolvePipelineFromLabels(ticket.labels);

      const jobData: IssueJobData = {
        installationId,
        repoOwner,
        repoName,
        repoPrivate: false,
        issueNumber: 0,
        issueTitle: ticket.title,
        issueBody: ticket.description ?? '',
        source: 'linear',
        trackerType: 'linear',
        trackerTicketId: ticket.id,
        pipeline,
      };

      const queue = createIssueQueue();
      await enqueueIssue(queue, jobData);

      log.info({ ticketId, pipeline }, 'Linear ticket enqueued for triage');
    } else {
      log.warn(
        'TRACKER_DEFAULT_REPO_OWNER/NAME or TRACKER_INSTALLATION_ID not configured -- Linear ticket not enqueued',
      );
    }
  } catch (err) {
    log.error(
      { err: String(err), ticketId },
      'Failed to process Linear webhook',
    );
    if (eventId) await logWebhookFailed(eventId, String(err));
    res.status(500).json({ error: 'Failed to process webhook' });
    return;
  }

  if (eventId) await logWebhookProcessed(eventId);
  recordWebhookDuration(source, Date.now() - startTime);
  res.status(202).json({ accepted: true });
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the Linear webhook HMAC-SHA256 signature.
 *
 * Linear signs webhook payloads with an HMAC-SHA256 digest using the
 * webhook secret as the key.  The signature is sent in the
 * ``Linear-Signature`` header as ``sha256=<hex-digest>``.
 */
function verifySignature(
  rawBody: Buffer,
  signatureHeader: string,
): boolean {
  const secret = config.trackers?.linear?.webhookSecret;
  if (!secret) {
    log.warn(
      'LINEAR_WEBHOOK_SECRET not configured -- skipping signature verification',
    );
    return true;
  }

  const prefix = 'sha256=';
  if (!signatureHeader || !signatureHeader.startsWith(prefix)) {
    log.warn('Invalid or missing Linear signature header');
    return false;
  }

  const expectedSignature = signatureHeader.slice(prefix.length);
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pipeline resolution
// ---------------------------------------------------------------------------

/**
 * Map Linear issue labels to a STAS pipeline name.
 *
 * This should stay in sync with ``workers/tracker/routing.py``.
 */
function resolvePipelineFromLabels(labels: string[]): string {
  const labelLower = labels.map((l) => l.toLowerCase());

  if (labelLower.includes('stas:feature')) return 'feature';
  if (labelLower.includes('stas:research')) return 'research';
  // Default to fix pipeline
  return 'default';
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function recordWebhookDuration(
  source: string,
  durationMs: number,
): void {
  try {
    // Dynamic import to avoid hard dependency in route module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const metrics = require('../webhooks/metrics.js');
    if (typeof metrics.recordWebhookDuration === 'function') {
      metrics.recordWebhookDuration(source, durationMs);
    }
  } catch {
    // metrics module not available -- non-fatal
  }
}

export { router as linearWebhookRouter };
