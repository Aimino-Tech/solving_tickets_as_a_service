/**
 * Retry Policy — per-task-type retry configuration with circuit breaker integration.
 *
 * Defines which task types should be retried, with what backoff strategy,
 * and integrates with the circuit breaker to stop retrying when the system
 * is overloaded.
 *
 * Usage:
 *   const policy = new RetryPolicy();
 *   if (policy.shouldRetryTask('fix_issue', new Error('timeout'), 1)) {
 *     const delay = policy.getDelay('fix_issue', 1);
 *     await wait(delay);
 *     await retry();
 *   }
 */

import { rootLogger } from '../utils/logger.js';
import { ExponentialBackoff } from './backoff.js';
import { CircuitBreaker, circuitBreaker as globalCircuitBreaker } from '../circuit-breaker/index.js';

const log = rootLogger.child({ module: 'retry-policy' });

// ── Types ───────────────────────────────────────────────────────────

export interface TaskRetryConfig {
  /** Maximum number of retry attempts for this task type. */
  maxRetries: number;
  /** Base delay for exponential backoff in milliseconds. */
  baseDelayMs: number;
  /** Backoff multiplier. */
  multiplier: number;
  /** Whether this task type is eligible for retry. */
  retryable: boolean;
  /** Circuit breaker key (defaults to task type). */
  circuitBreakerKey?: string;
}

export type RetryPolicyConfig = Record<string, TaskRetryConfig>;

// ── Default Configurations ──────────────────────────────────────────

const DEFAULT_TASK_CONFIGS: RetryPolicyConfig = {
  'fix_issue': {
    maxRetries: 3,
    baseDelayMs: 1000,
    multiplier: 4,
    retryable: true,
  },
  'triage': {
    maxRetries: 2,
    baseDelayMs: 500,
    multiplier: 4,
    retryable: true,
  },
  'sandbox': {
    maxRetries: 2,
    baseDelayMs: 2000,
    multiplier: 3,
    retryable: true,
  },
  'pr_creation': {
    maxRetries: 3,
    baseDelayMs: 1000,
    multiplier: 4,
    retryable: true,
  },
  'verification': {
    maxRetries: 2,
    baseDelayMs: 1000,
    multiplier: 4,
    retryable: true,
  },
  'notification': {
    maxRetries: 3,
    baseDelayMs: 500,
    multiplier: 3,
    retryable: true,
  },
  'webhook': {
    maxRetries: 3,
    baseDelayMs: 1000,
    multiplier: 4,
    retryable: true,
  },
};

// ── RetryPolicy ─────────────────────────────────────────────────────

export class RetryPolicy {
  private readonly configs: Map<string, TaskRetryConfig>;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly defaultConfig: TaskRetryConfig;

  constructor(
    configs?: RetryPolicyConfig,
    circuitBreaker?: CircuitBreaker,
  ) {
    this.configs = new Map(Object.entries(configs ?? DEFAULT_TASK_CONFIGS));
    this.circuitBreaker = circuitBreaker ?? globalCircuitBreaker;

    // Default config for unknown task types
    this.defaultConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      multiplier: 4,
      retryable: true,
    };
  }

  /**
   * Get the retry configuration for a task type.
   * Falls back to default config if task type is not explicitly configured.
   */
  getConfig(taskType: string): TaskRetryConfig {
    return this.configs.get(taskType) ?? this.defaultConfig;
  }

  /**
   * Determine if a task should be retried.
   * Checks:
   *   1. Task type is retryable
   *   2. Attempt is within maxRetries
   *   3. Error is retryable (not a fatal error)
   *   4. Circuit breaker allows it
   */
  shouldRetryTask(taskType: string, error: Error, attempt: number): boolean {
    const config = this.getConfig(taskType);
    const cbKey = config.circuitBreakerKey ?? taskType;

    // Check if task type is retryable
    if (!config.retryable) {
      log.debug({ taskType }, 'Task type is not retryable');
      return false;
    }

    // Check attempt count
    if (attempt > config.maxRetries) {
      log.warn({ taskType, attempt, maxRetries: config.maxRetries }, 'Max retries exceeded');
      return false;
    }

    // Check circuit breaker
    if (!this.circuitBreaker.isAllowed(cbKey)) {
      log.warn({ taskType, cbKey }, 'Circuit breaker open — not retrying');
      return false;
    }

    // Check if error is fatal (non-retryable)
    if (this.isFatalError(error)) {
      log.warn({ taskType, error: error.message }, 'Fatal error — not retrying');
      return false;
    }

    return true;
  }

  /**
   * Check if an error is fatal and should not be retried.
   */
  private isFatalError(error: Error): boolean {
    const fatalMessages = [
      'validation failed',
      'not found',
      'unauthorized',
      'forbidden',
      'invalid input',
      'rate limit exceeded',
    ];

    const msg = error.message.toLowerCase();
    return fatalMessages.some((fatal) => msg.includes(fatal));
  }

  /**
   * Get the delay for a given attempt on a task type.
   */
  getDelay(taskType: string, attempt: number): number {
    const config = this.getConfig(taskType);
    const backoff = new ExponentialBackoff(
      config.baseDelayMs,
      config.multiplier,
      config.maxRetries,
    );
    return backoff.getDelay(attempt);
  }

  /**
   * Register a new task type configuration.
   */
  registerTask(taskType: string, config: TaskRetryConfig): void {
    this.configs.set(taskType, config);
    log.info({ taskType, config }, 'Registered retry policy for task type');
  }

  /**
   * Get all registered task configurations.
   */
  getAllConfigs(): Record<string, TaskRetryConfig> {
    const result: Record<string, TaskRetryConfig> = {};
    for (const [key, value] of this.configs.entries()) {
      result[key] = { ...value };
    }
    return result;
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global retry policy instance.
 */
export const retryPolicy = new RetryPolicy();
