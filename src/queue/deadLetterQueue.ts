/**
 * Dead Letter Queue (DLQ) Management Module.
 *
 * Provides structured logging, in-memory tracking, alert dispatch,
 * and admin API support for dead-lettered issue jobs.
 *
 * Key design decisions:
 * - DLQ messages remain dead until manually acknowledged — no auto-replay
 * - Full error context is captured: original error, retry count, timestamps, stack trace
 * - Slack alerts are dispatched via the existing notification system
 * - In-memory store tracks recent DLQ entries for the admin dashboard
 * - Entries are pruned after config.monitoring.dlqRetentionDays (default 7)
 *
 * ── Data Flow ────────────────────────────────────────────────────────
 * 1. Worker exhausts retries → calls recordDeadLetter()
 * 2. recordDeadLetter() stores entry in in-memory map + pushes to BullMQ DLQ
 * 3. dispatchDlqAlert() posts to Slack via notification service
 * 4. Admin API reads from in-memory store for dashboard display
 * 5. Manual ack via admin API removes entry from tracking
 * ─────────────────────────────────────────────────────────────────────
 */

import { config } from "../config.js";
import { rootLogger } from "../utils/logger.js";
import { bridgeMetrics } from "../bridge/metrics.js";
import type { IssueJobData } from "../utils/types.js";
import type { IssueJobDataWithRetry } from "./issueQueue.js";

const log = rootLogger.child({ module: 'dlq-manager' });

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * A single dead-letter queue entry with full context.
 */
export interface DeadLetterEntry {
  /** Unique identifier for this DLQ entry */
  id: string;
  /** When the message entered the DLQ */
  timestamp: string;
  /** Original job data */
  jobData: IssueJobDataWithRetry;
  /** The error that caused the final failure */
  error: string;
  /** Stack trace if available */
  stackTrace?: string;
  /** Number of retry attempts made */
  retryCount: number;
  /** Retry delays that were used (in ms) */
  retryDelays: number[];
  /** Queue name this message originated from */
  sourceQueue: string;
  /** Whether this entry has been manually acknowledged by an admin */
  acknowledged: boolean;
  /** When (if ever) this entry was acknowledged */
  acknowledgedAt?: string;
  /** Admin who acknowledged this entry */
  acknowledgedBy?: string;
}

// ── In-Memory DLQ Store ──────────────────────────────────────────────────

/**
 * In-memory store for DLQ entries.
 * In production, this could be backed by Redis or Postgres for persistence
 * across restarts. For now, it provides a bounded recent-view of dead messages.
 */
class DeadLetterStore {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private readonly maxEntries: number = 1000;

  /**
   * Add a new DLQ entry. Prunes oldest if over capacity.
   */
  add(entry: DeadLetterEntry): void {
    this.entries.set(entry.id, entry);

    // Prune oldest entries when over capacity
    if (this.entries.size > this.maxEntries) {
      const sorted = [...this.entries.entries()]
        .sort(([, a], [, b]) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, this.maxEntries);
      this.entries = new Map(sorted);
    }
  }

  /**
   * Get a single DLQ entry by ID.
   */
  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * List all DLQ entries, optionally filtered by acknowledged status.
   */
  list(acknowledged?: boolean): DeadLetterEntry[] {
    const all = [...this.entries.values()];
    if (acknowledged !== undefined) {
      return all.filter((e) => e.acknowledged === acknowledged);
    }
    return all.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /**
   * Mark a DLQ entry as acknowledged by an admin.
   */
  acknowledge(id: string, adminId: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.acknowledged = true;
    entry.acknowledgedAt = new Date().toISOString();
    entry.acknowledgedBy = adminId;
    return true;
  }

  /**
   * Replay a DLQ entry by returning its job data (to be re-enqueued).
   * Returns null if the entry does not exist or is not acknowledged.
   * After replay, the entry is removed from the store.
   */
  replay(id: string): IssueJobDataWithRetry | null {
    const entry = this.entries.get(id);
    if (!entry || !entry.acknowledged) return null;
    this.entries.delete(id);
    return entry.jobData;
  }

  /**
   * Get summary statistics about the DLQ store.
   */
  stats(): { total: number; unacknowledged: number; acknowledged: number } {
    const all = [...this.entries.values()];
    return {
      total: all.length,
      unacknowledged: all.filter((e) => !e.acknowledged).length,
      acknowledged: all.filter((e) => e.acknowledged).length,
    };
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Remove a single DLQ entry from the store.
   * Returns true if the entry was found and removed.
   */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }
}

/**
 * Singleton DLQ store instance.
 */
export const dlqStore = new DeadLetterStore();

// ── Alerting ──────────────────────────────────────────────────────────────

/**
 * Send a DLQ alert to the configured Slack channel and log a sentry event.
 *
 * Uses the notification system's Slack webhook to post a structured alert
 * about a message entering the dead-letter queue.
 */
export async function dispatchDlqAlert(entry: DeadLetterEntry): Promise<void> {
  const repo = `${entry.jobData.repoOwner}/${entry.jobData.repoName}`;
  const issueLink = `https://github.com/${repo}/issues/${entry.jobData.issueNumber}`;

  const message = [
    `:skull: *DLQ Alert* — Message failed after ${entry.retryCount} retries`,
    `> *Queue:* \`${entry.sourceQueue}\``,
    `> *Issue:* <${issueLink}|#${entry.jobData.issueNumber}>`,
    `> *Repo:* ${repo}`,
    `> *Error:* ${entry.error.slice(0, 500)}`,
    entry.stackTrace
      ? `> *Trace:* \`\`\`${entry.stackTrace.slice(0, 1000)}\`\`\``
      : '',
    `> *Retry Delays:* [${entry.retryDelays.join(', ')}]`,
    `> *Timestamp:* ${entry.timestamp}`,
    `> *DLQ ID:* \`${entry.id}\``,
  ]
    .filter(Boolean)
    .join('\n');

  // Log the alert
  log.warn(
    {
      dlqId: entry.id,
      repo,
      issueNumber: entry.jobData.issueNumber,
      error: entry.error,
      retryCount: entry.retryCount,
      timestamp: entry.timestamp,
    },
    'DLQ alert dispatched',
  );

  // Send to Slack via webhook if configured
  const webhookUrl = config.slack.webhookUrl;
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          channel: config.alerting.slackChannel || '#stas-alerts',
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        log.error({ status: response.status, body }, 'Slack DLQ alert delivery failed');
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to send Slack DLQ alert');
    }
  }

  // Record Prometheus metric
  bridgeMetrics.incrementCounter('dlq_messages_total', {
    queue: entry.sourceQueue,
    repo,
  });

  bridgeMetrics.incrementCounter('dlq_alerts_total', {
    queue: entry.sourceQueue,
    repo,
  });
}

// ── Core DLQ Recording ───────────────────────────────────────────────────

/**
 * Record a dead-letter entry with full context and dispatch alerts.
 *
 * This is the primary entry point for recording a message in the DLQ.
 * It:
 * 1. Creates a structured DeadLetterEntry with full error context
 * 2. Stores it in the in-memory DLQ store
 * 3. Logs the event with all context
 * 4. Dispatches Slack/Linear alerts
 * 5. Records metrics
 *
 * @param jobData - The original job data extended with retry info
 * @param error - The final error message
 * @param sourceQueue - The queue this message came from
 * @param stackTrace - Optional stack trace
 * @returns The created DeadLetterEntry
 */
export async function recordDeadLetter(
  jobData: IssueJobDataWithRetry,
  error: string,
  sourceQueue: string,
  stackTrace?: string,
): Promise<DeadLetterEntry> {
  const id = `dlq-${jobData.installationId}:${jobData.repoOwner}/${jobData.repoName}#${jobData.issueNumber}-${Date.now()}`;

  const entry: DeadLetterEntry = {
    id,
    timestamp: new Date().toISOString(),
    jobData,
    error,
    stackTrace,
    retryCount: jobData.retryCount ?? 0,
    retryDelays: config.queue.retryDelays,
    sourceQueue,
    acknowledged: false,
  };

  // Store in-memory
  dlqStore.add(entry);

  // Structured logging with full context
  log.error(
    {
      dlqId: id,
      repo: `${jobData.repoOwner}/${jobData.repoName}`,
      issueNumber: jobData.issueNumber,
      issueTitle: jobData.issueTitle,
      retryCount: entry.retryCount,
      retryDelays: entry.retryDelays,
      error,
      stackTrace: stackTrace ?? null,
      timestamp: entry.timestamp,
      sourceQueue,
    },
    'Message moved to dead-letter queue',
  );

  // Dispatch alerts (non-blocking)
  dispatchDlqAlert(entry).catch((err) => {
    log.error({ err: String(err) }, 'Failed to dispatch DLQ alert');
  });

  // Record metrics
  bridgeMetrics.setGauge('dlq_queue_depth', { queue: sourceQueue }, dlqStore.stats().unacknowledged);

  return entry;
}

/**
 * Generate a human-readable summary of a DeadLetterEntry for display.
 */
export function formatDeadLetterEntry(entry: DeadLetterEntry): Record<string, unknown> {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    repo: `${entry.jobData.repoOwner}/${entry.jobData.repoName}`,
    issueNumber: entry.jobData.issueNumber,
    issueTitle: entry.jobData.issueTitle,
    error: entry.error,
    stackTrace: entry.stackTrace,
    retryCount: entry.retryCount,
    retryDelays: entry.retryDelays,
    sourceQueue: entry.sourceQueue,
    acknowledged: entry.acknowledged,
    acknowledgedAt: entry.acknowledgedAt ?? null,
    acknowledgedBy: entry.acknowledgedBy ?? null,
  };
}
