/**
 * Circuit Breaker — prevents cascading failures by stopping repeated calls
 * to a failing operation.
 *
 * States:
 *   CLOSED  — normal operation, calls pass through
 *   OPEN    — failures exceed threshold, calls are rejected
 *   HALF_OPEN — after reset timeout, one probe call is allowed
 *
 * Usage:
 *   const cb = new CircuitBreaker();
 *   if (cb.isAllowed('task_fix_issue')) {
 *     try {
 *       await doWork();
 *       cb.recordSuccess('task_fix_issue');
 *     } catch (err) {
 *       cb.recordFailure('task_fix_issue');
 *     }
 *   }
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'circuit-breaker' });

// ── Types ───────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
}

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 60_000;

// ── CircuitBreaker ─────────────────────────────────────────────────

export class CircuitBreaker {
  private readonly circuits = new Map<string, CircuitEntry>();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = DEFAULT_FAILURE_THRESHOLD, resetTimeoutMs = DEFAULT_RESET_TIMEOUT_MS) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  /**
   * Get or create a circuit entry for the given key.
   */
  private getEntry(key: string): CircuitEntry {
    let entry = this.circuits.get(key);
    if (!entry) {
      entry = {
        state: 'CLOSED',
        failureCount: 0,
        lastFailureTime: 0,
        lastSuccessTime: Date.now(),
      };
      this.circuits.set(key, entry);
    }
    return entry;
  }

  /**
   * Record a successful call — resets failure count and keeps circuit CLOSED.
   */
  recordSuccess(key: string): void {
    const entry = this.getEntry(key);
    entry.failureCount = 0;
    entry.lastSuccessTime = Date.now();
    if (entry.state === 'HALF_OPEN') {
      entry.state = 'CLOSED';
      log.info({ key }, 'Circuit breaker: HALF_OPEN -> CLOSED (success)');
    }
  }

  /**
   * Record a failed call — increments failure count, opens circuit at threshold.
   */
  recordFailure(key: string): void {
    const entry = this.getEntry(key);
    entry.failureCount++;
    entry.lastFailureTime = Date.now();

    if (entry.state === 'HALF_OPEN') {
      // Probe call failed, go back to OPEN
      entry.state = 'OPEN';
      log.warn({ key, failureCount: entry.failureCount }, 'Circuit breaker: HALF_OPEN -> OPEN (probe failed)');
    } else if (entry.failureCount >= this.failureThreshold && entry.state === 'CLOSED') {
      entry.state = 'OPEN';
      log.warn(
        { key, failureCount: entry.failureCount, threshold: this.failureThreshold },
        'Circuit breaker: CLOSED -> OPEN (threshold reached)',
      );
    }
  }

  /**
   * Check if a call is allowed to proceed.
   * - CLOSED: always allowed
   * - OPEN: only allowed if reset timeout has elapsed (transitions to HALF_OPEN)
   * - HALF_OPEN: allowed (one probe call)
   */
  isAllowed(key: string): boolean {
    const entry = this.getEntry(key);

    if (entry.state === 'CLOSED') {
      return true;
    }

    if (entry.state === 'OPEN') {
      const elapsed = Date.now() - entry.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        // Transition to HALF_OPEN — allow one probe call
        entry.state = 'HALF_OPEN';
        log.info({ key, elapsedMs: elapsed }, 'Circuit breaker: OPEN -> HALF_OPEN (reset timeout elapsed)');
        return true;
      }
      return false;
    }

    // HALF_OPEN — allow the probe call
    return true;
  }

  /**
   * Get the current state of a circuit.
   */
  getState(key: string): CircuitState {
    return this.getEntry(key).state;
  }

  /**
   * Get the failure count for a circuit.
   */
  getFailureCount(key: string): number {
    return this.getEntry(key).failureCount;
  }

  /**
   * Reset a specific circuit back to CLOSED.
   */
  reset(key: string): void {
    this.circuits.set(key, {
      state: 'CLOSED',
      failureCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: Date.now(),
    });
    log.info({ key }, 'Circuit breaker: reset to CLOSED');
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    this.circuits.clear();
    log.info('Circuit breaker: all circuits reset');
  }

  /**
   * Get a snapshot of all circuits.
   */
  getSnapshot(): Record<string, CircuitEntry> {
    const snapshot: Record<string, CircuitEntry> = {};
    for (const [key, entry] of this.circuits.entries()) {
      snapshot[key] = { ...entry };
    }
    return snapshot;
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global circuit breaker instance.
 */
export const circuitBreaker = new CircuitBreaker();
