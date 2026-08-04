/**
 * Linear State Sync — posts issue state transitions and progress comments
 * back to Linear from SYNTARO processing pipeline.
 *
 * This module is the write-back layer for Linear tracker integration:
 * - Updates issue status as SYNTARO progresses through stages
 * - Posts contextual comments at each stage
 * - Handles errors gracefully (write-back failures are non-fatal)
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *   import { syncLinearState } from './tracker/linearStateSync.js';
 *
 *   await syncLinearState('lin_123', 'processing', 'Investigating issue...');
 *   await syncLinearState('lin_123', 'fix_ready', 'Fix PR created at #42');
 *
 *   // Direct tracker access for advanced use:
 *   import { getLinearTracker } from './tracker/linearStateSync.js';
 *   const tracker = getLinearTracker();
 *   await tracker.updateStatus('lin_123', 'In Review');
 *   await tracker.postComment('lin_123', '✅ Fix is ready for review');
 * ──────────────────────────────────────────────────────────────────────
 */

import { LinearTracker } from '../trackers/linear.js';
import { getTracker } from '../trackers/index.js';
import { config } from '../config.js';
import { createLinearClient } from './linearPoller.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'linear-state-sync' });

// ---------------------------------------------------------------------------
// Status mapping — SYNTARO stages → Linear workflow states
// ---------------------------------------------------------------------------

/**
 * Maps SYNTARO processing stages to Linear workflow state names.
 * Linear states are team-specific, so these are best-effort matches.
 */
export const STAGE_TO_LINEAR_STATE: Record<string, string> = {
  received: 'Triage',
  processing: 'In Progress',
  triaging: 'In Progress',
  fix_ready: 'In Review',
  fix_failed: 'Backlog',
  fix_applied: 'In Review',
  needs_feedback: 'Backlog',
  completed: 'Done',
  cancelled: 'Canceled',
};

// ---------------------------------------------------------------------------
// Stage sync
// ---------------------------------------------------------------------------

/**
 * Sync a SYNTARO processing stage to a Linear issue:
 * 1. Updates the Linear issue status (if a mapping exists)
 * 2. Posts a contextual comment with the provided message
 *
 * Both operations are independent — if one fails, the other still proceeds.
 * Write-back failures are logged but never thrown (non-fatal).
 */
export async function syncLinearState(
  ticketId: string,
  stage: string,
  message: string,
): Promise<void> {
  const tracker = getLinearTracker();
  if (!tracker) return;

  // Resolve Linear state name from stage
  const linearState = STAGE_TO_LINEAR_STATE[stage];
  if (linearState) {
    try {
      await tracker.updateStatus(ticketId, linearState);
      log.info({ ticketId, stage, linearState }, 'Linear issue status updated');
    } catch (err) {
      log.warn(
        { err: String(err), ticketId, stage, linearState },
        'Failed to update Linear issue status (non-fatal)',
      );
    }
  } else {
    log.debug({ ticketId, stage }, 'No Linear state mapping for stage — skipping status update');
  }

  // Post comment with progress info
  if (message) {
    try {
      await tracker.postComment(ticketId, message);
      log.info({ ticketId, stage }, 'Linear issue comment posted');
    } catch (err) {
      log.warn(
        { err: String(err), ticketId, stage },
        'Failed to post Linear issue comment (non-fatal)',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Specific stage sync helpers
// ---------------------------------------------------------------------------

/**
 * Notify Linear that SYNTARO has received and acknowledged the issue.
 */
export async function notifyReceived(ticketId: string): Promise<void> {
  await syncLinearState(
    ticketId,
    'received',
    `🔄 **SYNTARO received**\n\nIssue has been picked up for processing. ETA: ~5-10 minutes.`,
  );
}

/**
 * Notify Linear that SYNTARO is actively investigating the issue.
 */
export async function notifyInvestigating(ticketId: string): Promise<void> {
  await syncLinearState(
    ticketId,
    'processing',
    `🔍 **SYNTARO investigating**\n\nAnalyzing the issue, exploring the codebase, and formulating a fix strategy.`,
  );
}

/**
 * Notify Linear that a fix has been successfully created.
 */
export async function notifyFixReady(
  ticketId: string,
  prUrl?: string,
  prNumber?: number,
): Promise<void> {
  const prLink = prUrl ? `[#${prNumber || 'PR'}](${prUrl})` : 'a fix branch';
  await syncLinearState(
    ticketId,
    'fix_ready',
    `✅ **SYNTARO fix ready** — ${prLink}\n\nConfidence: High\n\n> Automated by SYNTARO — please review.`,
  );
}

/**
 * Notify Linear that the fix attempt failed.
 */
export async function notifyFixFailed(
  ticketId: string,
  reason: string,
): Promise<void> {
  await syncLinearState(
    ticketId,
    'fix_failed',
    `❌ **SYNTARO fix failed**\n\nReason: ${reason}\n\n> Automated by SYNTARO — manual intervention may be required.`,
  );
}

/**
 * Notify Linear that processing is complete and the issue has been resolved.
 */
export async function notifyCompleted(ticketId: string, summary: string): Promise<void> {
  await syncLinearState(
    ticketId,
    'completed',
    `✅ **SYNTARO completed**\n\n${summary}`,
  );
}

// ---------------------------------------------------------------------------
// Tracker access
// ---------------------------------------------------------------------------

/**
 * Get the LinearTracker instance, or null if not configured.
 */
export function getLinearTracker(): LinearTracker | undefined {
  return getTracker('linear') as LinearTracker | undefined;
}

/**
 * Check if Linear write-back is available (tracker configured).
 */
export function isLinearSyncAvailable(): boolean {
  return !!getTracker('linear');
}
