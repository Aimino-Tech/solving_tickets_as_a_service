/**
 * Usage metering event types and typed event emitter.
 *
 * Events:
 *   usage.recorded — emitted when a pipeline run completes and usage is persisted
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Usage record — the payload emitted on every recorded event
// ---------------------------------------------------------------------------

export interface UsageRecord {
  /** Unique run ID correlating all phases of one pipeline execution */
  runId: string;

  /** Which tracker/platform this pipeline serves (github, linear, jira, etc.) */
  source: string;

  /** Total credits consumed for this run */
  totalCredits: number;

  /** Per-phase breakdown */
  phases: PhaseUsage[];

  /** Timestamp when the run started */
  startedAt: string;

  /** Timestamp when the run ended */
  endedAt: string;

  /** Wall-clock duration in milliseconds */
  durationMs: number;

  /** Model(s) used during this run */
  modelsUsed: string[];

  /** Number of retry attempts across all phases */
  retryCount: number;

  /** Whether a fallback model was activated */
  fallbackUsed: boolean;

  /** Whether a PR was created as a result */
  prCreated: boolean;
}

export interface PhaseUsage {
  name: string;
  credits: number;
  durationMs: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Typed event map
// ---------------------------------------------------------------------------

export interface MeteringEvents {
  'usage.recorded': (record: UsageRecord) => void;
}

// ---------------------------------------------------------------------------
// Singleton emitter
// ---------------------------------------------------------------------------

class MeteringEventEmitter extends EventEmitter {
  emit<K extends keyof MeteringEvents>(event: K, ...args: Parameters<MeteringEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof MeteringEvents>(event: K, listener: MeteringEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof MeteringEvents>(event: K, listener: MeteringEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof MeteringEvents>(event: K, listener: MeteringEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const meteringEvents = new MeteringEventEmitter();
