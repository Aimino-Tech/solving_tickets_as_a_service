/**
 * UsageTracker — wraps the agent pipeline to record usage metrics.
 *
 * Tracks:
 *   - Triage calls (cheap model classification)
 *   - OpenCode agent runs (primary model)
 *   - OpenCode fallback model runs
 *   - Sandbox time (for cost multiplier)
 *   - Retries and fallback attempts
 *   - PR creation
 *
 * Usage:
 *   const tracker = new UsageTracker({ source: 'github', runId: 'abc-123' });
 *   tracker.start();
 *   // ... pipeline runs ...
 *   tracker.recordTriage();
 *   tracker.recordAgentRun({ phase: 'primary', model: 'claude-sonnet-4' });
 *   tracker.recordFallback({ model: 'gpt-4o' });
 *   tracker.recordPRCreated();
 *   const record = tracker.stop();
 *   // record is also emitted as 'usage.recorded' event
 */

import { randomUUID } from 'node:crypto';
import { meteringEvents, type PhaseUsage, type UsageRecord } from './events.js';
import { calculatePipelineCost } from './costs.js';
import { rootLogger } from '../utils/logger.js';
import { captureEvent } from '../analytics/tracker.js';

const log = rootLogger.child({ module: 'usage-tracker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageTrackerOptions {
  /** Source platform (github, gitlab, bitbucket, linear, jira, etc.) */
  source: string;

  /** Optional explicit run ID (auto-generated if omitted) */
  runId?: string;

  /** Installation/account identifier for cross-reference */
  installationId?: number | string;

  /** Repo identifier for audit trail */
  repo?: string;

  /** Issue/ticket number for audit trail */
  issueNumber?: number | string;
}

export interface AgentRunInfo {
  /** Phase label: 'primary' | 'fallback' */
  phase: string;
  /** Model identifier used */
  model: string;
  /** Duration of this specific run in ms */
  durationMs?: number;
  /** Whether this run was a retry */
  isRetry?: boolean;
}

// ---------------------------------------------------------------------------
// In-memory store (ephemeral — replace with DB in production)
// ---------------------------------------------------------------------------

interface StoredUsage extends UsageRecord {
  installationId?: number | string;
  repo?: string;
  issueNumber?: number | string;
}

const usageStore: StoredUsage[] = [];

/**
 * Access the in-memory usage store (for API endpoints).
 */
export function getUsageStore(): StoredUsage[] {
  return usageStore;
}

// ---------------------------------------------------------------------------
// UsageTracker class
// ---------------------------------------------------------------------------

export class UsageTracker {
  readonly runId: string;
  readonly source: string;
  readonly installationId?: number | string;
  readonly repo?: string;
  readonly issueNumber?: number | string;

  private _startedAt: number = 0;
  private _endedAt: number = 0;
  private _phases: PhaseUsage[] = [];
  private _modelsUsed = new Set<string>();
  private _retryCount = 0;
  private _fallbackUsed = false;
  private _prCreated = false;
  private _sandboxDurationMs: number = 0;
  private _triagePerformed = false;
  private _primaryRunCount = 0;
  private _fallbackRunCount = 0;
  private _running = false;

  constructor(options: UsageTrackerOptions) {
    this.runId = options.runId ?? randomUUID();
    this.source = options.source;
    this.installationId = options.installationId;
    this.repo = options.repo;
    this.issueNumber = options.issueNumber;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start the pipeline timer. Call once at pipeline begin.
   */
  start(): void {
    if (this._running) {
      log.warn({ runId: this.runId }, 'UsageTracker already started — resetting');
    }
    this._startedAt = Date.now();
    this._running = true;
    log.debug({ runId: this.runId, source: this.source }, 'Usage tracking started');
  }

  /**
   * Stop the pipeline timer and finalize the usage record.
   * Returns the UsageRecord and emits 'usage.recorded'.
   */
  stop(): UsageRecord {
    this._endedAt = Date.now();
    this._running = false;

    const durationMs = this._endedAt - this._startedAt;

    const totalCredits = calculatePipelineCost({
      triagePerformed: this._triagePerformed,
      primaryRunCount: this._primaryRunCount,
      fallbackRunCount: this._fallbackRunCount,
      retryCount: this._retryCount,
      prCreated: this._prCreated,
      sandboxDurationMs: this._sandboxDurationMs,
    });

    const record: UsageRecord = {
      runId: this.runId,
      source: this.source,
      totalCredits,
      phases: [...this._phases],
      startedAt: new Date(this._startedAt).toISOString(),
      endedAt: new Date(this._endedAt).toISOString(),
      durationMs,
      modelsUsed: Array.from(this._modelsUsed),
      retryCount: this._retryCount,
      fallbackUsed: this._fallbackUsed,
      prCreated: this._prCreated,
    };

    // Persist to in-memory store
    const stored: StoredUsage = {
      ...record,
      installationId: this.installationId,
      repo: this.repo,
      issueNumber: this.issueNumber,
    };
    usageStore.push(stored);

    // Emit event for real-time consumers
    meteringEvents.emit('usage.recorded', record);

    log.info(
      {
        runId: this.runId,
        totalCredits,
        durationMs,
        phases: this._phases.length,
        models: record.modelsUsed,
      },
      'Usage recorded',
    );

    // Track fix_completed in PostHog
    try {
      captureEvent('fix_completed', this.runId, {
        source: this.source,
        totalCredits,
        durationMs,
        prCreated: this._prCreated,
        retryCount: this._retryCount,
        fallbackUsed: this._fallbackUsed,
        modelsUsed: record.modelsUsed,
        installationId: this.installationId,
        repo: this.repo,
        issueNumber: this.issueNumber,
      });
    } catch (analyticsErr) {
      log.error({ err: String(analyticsErr) }, 'Failed to track fix_completed event');
    }

    return record;
  }

  // ── Phase recorders ────────────────────────────────────────────────

  /**
   * Record a triage/classification call.
   */
  recordTriage(model?: string): void {
    this._triagePerformed = true;
    if (model) this._modelsUsed.add(model);
    this._phases.push({
      name: 'triage',
      credits: 0, // computed at stop()
      durationMs: 0,
      model,
    });
  }

  /**
   * Record a primary OpenCode agent run.
   */
  recordAgentRun(info: AgentRunInfo): void {
    this._primaryRunCount++;
    if (info.isRetry) this._retryCount++;
    this._modelsUsed.add(info.model);
    this._phases.push({
      name: `agent:${info.phase}`,
      credits: 0,
      durationMs: info.durationMs ?? 0,
      model: info.model,
      metadata: info.isRetry ? { retry: true } : undefined,
    });
  }

  /**
   * Record a fallback model invocation.
   */
  recordFallback(info: AgentRunInfo): void {
    this._fallbackUsed = true;
    this._fallbackRunCount++;
    this._modelsUsed.add(info.model);
    this._phases.push({
      name: `agent:${info.phase}`,
      credits: 0,
      durationMs: info.durationMs ?? 0,
      model: info.model,
      metadata: { fallback: true },
    });
  }

  /**
   * Record sandbox execution time (for cost multiplier).
   */
  recordSandboxTime(durationMs: number): void {
    this._sandboxDurationMs += durationMs;
    this._phases.push({
      name: 'sandbox',
      credits: 0,
      durationMs,
    });
  }

  /**
   * Record that a PR was created.
   */
  recordPRCreated(): void {
    this._prCreated = true;
    this._phases.push({
      name: 'pr-creation',
      credits: 0,
      durationMs: 0,
    });

    try {
      captureEvent('pr_created', this.runId, {
        source: this.source,
        installationId: this.installationId,
        repo: this.repo,
        issueNumber: this.issueNumber,
        runId: this.runId,
      });
    } catch (analyticsErr) {
      log.error({ err: String(analyticsErr) }, 'Failed to track pr_created event');
    }
  }

  /**
   * Record a generic phase (for custom/extensible usage).
   */
  recordPhase(name: string, durationMs: number, metadata?: Record<string, unknown>): void {
    this._phases.push({
      name,
      credits: 0,
      durationMs,
      metadata,
    });
  }

  // ── Query helpers ──────────────────────────────────────────────────

  /**
   * Get total duration so far (if still running, current elapsed time).
   */
  getElapsedMs(): number {
    const end = this._endedAt || Date.now();
    return end - this._startedAt;
  }

  /**
   * Whether tracking is currently active.
   */
  get isRunning(): boolean {
    return this._running;
  }
}

// ---------------------------------------------------------------------------
// Convenience: create a tracker and wrap an async pipeline function
// ---------------------------------------------------------------------------

/**
 * Wraps an async function with a UsageTracker that records start/stop automatically.
 */
export async function withUsageTracking<T>(
  options: UsageTrackerOptions,
  fn: (tracker: UsageTracker) => Promise<T>,
): Promise<{ result: T; usage: UsageRecord }> {
  const tracker = new UsageTracker(options);
  tracker.start();
  try {
    const result = await fn(tracker);
    const usage = tracker.stop();
    return { result, usage };
  } catch (err) {
    // Still record usage even on failure (partial usage)
    const usage = tracker.stop();
    log.warn({ runId: tracker.runId, error: String(err) }, 'Usage tracking completed with error');
    throw err;
  }
}
