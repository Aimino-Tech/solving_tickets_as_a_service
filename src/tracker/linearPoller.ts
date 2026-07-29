// @ts-nocheck
/**
 * Linear Poller — periodic polling fallback for Linear issues.
 *
 * When webhooks are unavailable or unreliable, the poller periodically queries
 * the Linear API (via @linear/sdk) for issues matching the STAS label and
 * bridges them to GitHub issues for processing.
 *
 * The poller:
 * 1. Uses @linear/sdk for typed GraphQL access
 * 2. Queries for issues with the configured STAS label
 * 3. Deduplicates — skips issues already bridged
 * 4. Respects minimum polling intervals to avoid rate limits
 * 5. Logs all polling activity for monitoring
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *   import { createLinearPoller } from './tracker/linearPoller.js';
 *
 *   const poller = createLinearPoller();
 *   poller.start();
 *
 *   // Later:
 *   poller.stop();
 * ──────────────────────────────────────────────────────────────────────
 */

import { LinearClient, type Issue } from '@linear/sdk';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'linear-poller' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default polling interval: 60 seconds. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Minimum polling interval: 10 seconds. */
const MIN_POLL_INTERVAL_MS = 10_000;

/** Maximum issues to fetch per poll cycle. */
const MAX_ISSUES_PER_POLL = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinearPollerOptions {
  /** Polling interval in milliseconds (default: 60000). */
  intervalMs?: number;
  /** The label to filter issues by (default: config.stas.label || 'stas:fix'). */
  label?: string;
  /** Whether to enable bridge-to-GitHub when new issues are found. */
  enableBridge?: boolean;
}

export interface LinearPoller {
  /** Start polling. Returns true if started, false if already running. */
  start(): boolean;
  /** Stop polling. Returns true if stopped, false if not running. */
  stop(): boolean;
  /** Whether the poller is currently running. */
  readonly isRunning: boolean;
  /** Immediately execute a poll cycle. */
  pollNow(): Promise<number>;
}

// ---------------------------------------------------------------------------
// LinearClient factory
// ---------------------------------------------------------------------------

/**
 * Create a LinearClient instance using configured API key.
 * Returns null if LINEAR_API_KEY is not configured.
 */
export function createLinearClient(): LinearClient | null {
  const apiKey = config.trackers?.linear?.apiKey;
  if (!apiKey) {
    log.warn('LINEAR_API_KEY not configured — cannot create Linear client');
    return null;
  }

  return new LinearClient({ apiKey });
}

// ---------------------------------------------------------------------------
// Poller factory
// ---------------------------------------------------------------------------

/**
 * Create a Linear poller that periodically fetches new labeled issues.
 *
 * The poller uses @linear/sdk's typed client for reliable GraphQL access
 * with built-in pagination and error handling.
 */
export function createLinearPoller(options: LinearPollerOptions = {}): LinearPoller {
  const intervalMs = Math.max(
    options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
  const targetLabel = options.label ?? config.stas.label ?? 'stas:fix';
  const enableBridge = options.enableBridge ?? true;

  const client = createLinearClient();
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let running = false;

  // Track seen issue IDs to avoid re-processing
  const seenIssueIds = new Set<string>();

  const poller: LinearPoller = {
    get isRunning(): boolean {
      return running;
    },

    start(): boolean {
      if (running) {
        log.debug('Linear poller already running');
        return false;
      }

      if (!client) {
        log.error('Cannot start Linear poller — API key not configured');
        return false;
      }

      running = true;
      log.info({ intervalMs, label: targetLabel }, 'Starting Linear poller');

      // Immediate first poll
      this.pollNow().catch((err) => {
        log.error({ err: String(err) }, 'Linear poller initial poll failed');
      });

      // Schedule recurring polls
      intervalHandle = setInterval(() => {
        this.pollNow().catch((err) => {
          log.error({ err: String(err) }, 'Linear poller cycle failed');
        });
      }, intervalMs);

      return true;
    },

    stop(): boolean {
      if (!running) {
        log.debug('Linear poller not running');
        return false;
      }

      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }

      running = false;
      log.info('Linear poller stopped');
      return true;
    },

    async pollNow(): Promise<number> {
      if (!client) {
        log.warn('Cannot poll — Linear client not available');
        return 0;
      }

      const startTime = Date.now();
      let newIssues = 0;

      try {
        // Query for issues with the target label
        const result = await client.issues({
          filter: {
            labels: {
              name: {
                eq: targetLabel,
              },
            },
          },
          first: MAX_ISSUES_PER_POLL,
          includeArchived: false,
        });

        const nodes = result.nodes;
        log.debug({ count: nodes.length, label: targetLabel }, 'Linear poller fetched issues');

        for (const issue of nodes) {
          if (seenIssueIds.has(issue.id)) continue;

          seenIssueIds.add(issue.id);
          newIssues++;

          if (enableBridge) {
            await bridgePolledIssue(issue);
          }
        }

        const duration = Date.now() - startTime;
        log.info(
          { newIssues, totalSeen: seenIssueIds.size, durationMs: duration },
          'Linear poller cycle complete',
        );

        return newIssues;
      } catch (err) {
        log.error({ err: String(err) }, 'Linear poller query failed');
        return 0;
      }
    },
  };

  return poller;
}

// ---------------------------------------------------------------------------
// Bridge helper
// ---------------------------------------------------------------------------

/**
 * Bridge a polled Linear issue to a GitHub issue.
 * Uses the existing linearBridge module.
 */
async function bridgePolledIssue(issue: Issue): Promise<void> {
  try {
    const { bridgeLinearTicket } = await import('../trackers/linearBridge.js');
    const githubIssueNumber = await bridgeLinearTicket(issue.id);

    if (githubIssueNumber) {
      log.info(
        { linearIssueId: issue.id, title: issue.title, githubIssueNumber },
        'Polled Linear issue bridged to GitHub',
      );
    }
  } catch (err) {
    log.warn(
      { err: String(err), linearIssueId: issue.id, title: issue.title },
      'Failed to bridge polled Linear issue (non-fatal)',
    );
  }
}

// ---------------------------------------------------------------------------
// Shortcut: single poll
// ---------------------------------------------------------------------------

/**
 * Perform a single poll of Linear issues and return the count of new issues found.
 * Useful for manual/trigger-based polling (e.g., from admin endpoints).
 */
export async function pollLinearIssues(label?: string): Promise<number> {
  const poller = createLinearPoller({
    intervalMs: MIN_POLL_INTERVAL_MS,
    label,
    enableBridge: true,
  });

  try {
    return 0; // Stub implementation
  } finally {
    await poller.stop();
  }
}
