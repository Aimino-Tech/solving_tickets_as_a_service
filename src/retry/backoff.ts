/**
 * Exponential Backoff — calculates retry delays with exponential growth.
 *
 * Strategy: delay = baseDelay * (multiplier ^ (attempt - 1))
 *   attempt 1 -> 1s
 *   attempt 2 -> 4s
 *   attempt 3 -> 16s
 *
 * Usage:
 *   const backoff = new ExponentialBackoff();
 *   const delay = backoff.getDelay(1); // 1000ms
 *   const shouldRetry = backoff.shouldRetry(1); // true
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'backoff' });

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_BASE_DELAY_MS = 1000; // 1 second
const DEFAULT_MULTIPLIER = 4;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_DELAY_MS = 300_000; // 5 minutes cap

// ── ExponentialBackoff ──────────────────────────────────────────────

export class ExponentialBackoff {
  private readonly baseDelayMs: number;
  private readonly multiplier: number;
  private readonly maxRetries: number;
  private readonly maxDelayMs: number;

  constructor(
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    multiplier = DEFAULT_MULTIPLIER,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
  ) {
    this.baseDelayMs = baseDelayMs;
    this.multiplier = multiplier;
    this.maxRetries = maxRetries;
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Calculate delay for a given attempt number (1-indexed).
   * Returns the delay in milliseconds.
   *
   * Examples:
   *   getDelay(1) -> 1000ms  (1s)
   *   getDelay(2) -> 4000ms  (4s)
   *   getDelay(3) -> 16000ms (16s)
   */
  getDelay(attempt: number): number {
    if (attempt < 1) {
      log.warn({ attempt }, 'getDelay called with attempt < 1, clamping to 1');
      attempt = 1;
    }

    const delay = this.baseDelayMs * Math.pow(this.multiplier, attempt - 1);
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * Check if the given attempt should be retried.
   * Returns true if attempt <= maxRetries.
   */
  shouldRetry(attempt: number): boolean {
    return attempt <= this.maxRetries;
  }

  /**
   * Get the maximum number of retries.
   */
  getMaxRetries(): number {
    return this.maxRetries;
  }

  /**
   * Get all retry delays as an array (for documentation/metrics).
   */
  getAllDelays(): number[] {
    const delays: number[] = [];
    for (let i = 1; i <= this.maxRetries; i++) {
      delays.push(this.getDelay(i));
    }
    return delays;
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global exponential backoff instance.
 */
export const exponentialBackoff = new ExponentialBackoff();
