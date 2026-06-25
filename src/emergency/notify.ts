/**
 * Emergency Stop — Linear issue notification.
 *
 * When the kill switch is activated, this module notifies all active
 * tracked issues via the Linear API. This ensures that ticket stakeholders
 * are immediately aware that agent processing has been halted.
 *
 * Usage:
 *   import { notifyActiveIssues } from './emergency/notify.js';
 *   await notifyActiveIssues('Critical vulnerability in sandbox environment');
 *
 * The Linear tracker module is reused from src/trackers/linear.ts.
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'emergency-notify' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveIssue {
  ticketId: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Active issue tracking (simple in-memory store of active Linear tickets)
// ---------------------------------------------------------------------------

/**
 * In-memory registry of active issues being tracked by the system.
 * This is populated by the tracker bridge when tickets are picked up.
 * In a full production system, this would be backed by Redis or the database.
 */
const _activeIssues = new Map<string, ActiveIssue>();

/**
 * Register a ticket as actively being worked on.
 * Called by the tracker bridge when a ticket enters the pipeline.
 */
export function registerActiveIssue(ticketId: string, title: string): void {
  _activeIssues.set(ticketId, { ticketId, title });
  log.debug({ ticketId, title }, 'Registered active issue for emergency notifications');
}

/**
 * Unregister a ticket when work completes or is cancelled.
 */
export function unregisterActiveIssue(ticketId: string): void {
  _activeIssues.delete(ticketId);
  log.debug({ ticketId }, 'Unregistered active issue');
}

/**
 * Get all currently active issues.
 */
export function getActiveIssues(): ActiveIssue[] {
  return Array.from(_activeIssues.values());
}

// ---------------------------------------------------------------------------
// Linear API helper (reuses the same GraphQL pattern from src/trackers/linear.ts)
// ---------------------------------------------------------------------------

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Post a comment to a Linear issue using the Linear GraphQL API.
 *
 * @param ticketId - The Linear ticket ID (e.g., "AIM-1234")
 * @param body - The comment text to post
 */
async function postLinearComment(ticketId: string, body: string): Promise<void> {
  const apiKey = config.trackers?.linear?.apiKey;
  if (!apiKey) {
    log.warn('LINEAR_API_KEY not configured — skipping comment on Linear issue');
    return;
  }

  const mutation = `
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id }
      }
    }
  `;

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        input: {
          issueId: ticketId,
          body,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear API error (${response.status}): ${text}`);
  }

  const bodyRes = (await response.json()) as {
    data?: { commentCreate?: { success: boolean; comment?: { id: string } } };
    errors?: Array<{ message: string }>;
  };

  if (bodyRes.errors?.length) {
    throw new Error(`Linear GraphQL error: ${bodyRes.errors.map((e) => e.message).join('; ')}`);
  }

  if (!bodyRes.data?.commentCreate?.success) {
    throw new Error(`Failed to post comment on Linear issue ${ticketId}`);
  }

  log.info({ ticketId, commentId: bodyRes.data.commentCreate.comment?.id }, 'Emergency notification posted to Linear');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post an emergency stop notification comment on every active Linear issue.
 *
 * The comment includes:
 *   - Timestamp of when the stop was activated
 *   - The reason for the stop
 *   - A note that agents will not resume until manually cleared
 *
 * @param reason - The reason the kill switch was activated
 */
export async function notifyActiveIssues(reason: string): Promise<void> {
  const apiKey = config.trackers?.linear?.apiKey;
  if (!apiKey) {
    log.info('LINEAR_API_KEY not configured — skipping Linear notifications');
    return;
  }

  const activeIssues = getActiveIssues();
  if (activeIssues.length === 0) {
    log.info('No active issues to notify — skipping Linear notifications');
    return;
  }

  const timestamp = new Date().toISOString();
  const commentBody = [
    '🚨 **STAS Emergency Stop Activated**',
    '',
    `**Timestamp:** ${timestamp}`,
    `**Reason:** ${reason}`,
    '',
    'All agents have been halted immediately. No new fixes will be dispatched and any currently running agents have been terminated.',
    '',
    'Agents will **not** resume until the emergency stop is manually cleared by an administrator.',
    '',
    'Please check the STAS dashboard or contact your administrator for more information.',
  ].join('\n');

  let successCount = 0;
  let failCount = 0;

  for (const issue of activeIssues) {
    try {
      await postLinearComment(issue.ticketId, commentBody);
      successCount++;
    } catch (err) {
      log.error({ err: String(err), ticketId: issue.ticketId }, 'Failed to notify Linear issue');
      failCount++;
    }
  }

  log.info(
    { totalCount: activeIssues.length, successCount, failCount },
    'Completed notifying active Linear issues about emergency stop',
  );
}
