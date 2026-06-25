/**
 * Tests for ExponentialBackoff, RetryPolicy, and CircuitBreaker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExponentialBackoff } from '../../retry/backoff.js';
import { RetryPolicy } from '../../retry/policy.js';
import { CircuitBreaker } from '../../circuit-breaker/index.js';

// ── ExponentialBackoff ─────────────────────────────────────────────

describe('ExponentialBackoff', () => {
  it('returns 1s, 4s, 16s for attempts 1, 2, 3 with defaults', () => {
    const backoff = new ExponentialBackoff(1000, 4, 3);

    expect(backoff.getDelay(1)).toBe(1000);   // 1^4 = 1s
    expect(backoff.getDelay(2)).toBe(4000);   // 4^1 = 4s
    expect(backoff.getDelay(3)).toBe(16000);  // 16^1 = 16s
  });

  it('honors maxRetries', () => {
    const backoff = new ExponentialBackoff(1000, 4, 3);

    expect(backoff.shouldRetry(1)).toBe(true);
    expect(backoff.shouldRetry(2)).toBe(true);
    expect(backoff.shouldRetry(3)).toBe(true);
    expect(backoff.shouldRetry(4)).toBe(false);
    expect(backoff.shouldRetry(5)).toBe(false);
  });

  it('getMaxRetries returns the configured value', () => {
    const backoff = new ExponentialBackoff(1000, 4, 5);
    expect(backoff.getMaxRetries()).toBe(5);
  });

  it('caps delay at maxDelayMs', () => {
    const backoff = new ExponentialBackoff(1000, 1000, 3, 10_000);
    // attempt 2: 1000 * 1000^1 = 1,000,000 — capped at 10,000
    expect(backoff.getDelay(2)).toBe(10_000);
    // attempt 3: 1000 * 1000^2 = 1,000,000,000 — capped at 10,000
    expect(backoff.getDelay(3)).toBe(10_000);
  });

  it('clamps attempt < 1 to 1', () => {
    const backoff = new ExponentialBackoff(1000, 4, 3);
    expect(backoff.getDelay(0)).toBe(1000);
    expect(backoff.getDelay(-1)).toBe(1000);
  });

  it('getAllDelays returns correct array', () => {
    const backoff = new ExponentialBackoff(1000, 4, 3);
    expect(backoff.getAllDelays()).toEqual([1000, 4000, 16000]);
  });

  it('works with custom base delay and multiplier', () => {
    const backoff = new ExponentialBackoff(2000, 2, 3);
    expect(backoff.getDelay(1)).toBe(2000);
    expect(backoff.getDelay(2)).toBe(4000);
    expect(backoff.getDelay(3)).toBe(8000);
  });
});

// ── CircuitBreaker ─────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker(5, 60_000);
  });

  it('starts CLOSED and allows calls', () => {
    expect(cb.getState('test')).toBe('CLOSED');
    expect(cb.isAllowed('test')).toBe(true);
  });

  it('opens after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      expect(cb.isAllowed('test')).toBe(true);
      cb.recordFailure('test');
    }

    expect(cb.getState('test')).toBe('OPEN');
    expect(cb.isAllowed('test')).toBe(false);
  });

  it('does not open before 5 failures', () => {
    for (let i = 0; i < 4; i++) {
      cb.recordFailure('test');
    }

    expect(cb.getState('test')).toBe('CLOSED');
    expect(cb.isAllowed('test')).toBe(true);
  });

  it('resets failure count on success', () => {
    for (let i = 0; i < 4; i++) {
      cb.recordFailure('test');
    }
    cb.recordSuccess('test');

    expect(cb.getState('test')).toBe('CLOSED');
    expect(cb.getFailureCount('test')).toBe(0);
  });

  it('transitions to HALF_OPEN after reset timeout', () => {
    // Open the circuit
    for (let i = 0; i < 5; i++) {
      cb.recordFailure('test');
    }
    expect(cb.getState('test')).toBe('OPEN');
    expect(cb.isAllowed('test')).toBe(false);

    // Advance time past the reset timeout
    vi.advanceTimersByTime(60_001);

    // Should transition to HALF_OPEN and allow one probe
    expect(cb.isAllowed('test')).toBe(true);
    expect(cb.getState('test')).toBe('HALF_OPEN');
  });

  it('transitions HALF_OPEN -> CLOSED on probe success', () => {
    // Open -> HALF_OPEN
    for (let i = 0; i < 5; i++) {
      cb.recordFailure('test');
    }
    vi.advanceTimersByTime(60_001);
    expect(cb.isAllowed('test')).toBe(true); // probe

    // Probe succeeds
    cb.recordSuccess('test');
    expect(cb.getState('test')).toBe('CLOSED');
  });

  it('transitions HALF_OPEN -> OPEN on probe failure', () => {
    // Open -> HALF_OPEN
    for (let i = 0; i < 5; i++) {
      cb.recordFailure('test');
    }
    vi.advanceTimersByTime(60_001);
    expect(cb.isAllowed('test')).toBe(true); // probe

    // Probe fails
    cb.recordFailure('test');
    expect(cb.getState('test')).toBe('OPEN');
  });

  it('supports multiple independent circuits', () => {
    // Open 'svc-a', keep 'svc-b' closed
    for (let i = 0; i < 5; i++) {
      cb.recordFailure('svc-a');
    }

    expect(cb.getState('svc-a')).toBe('OPEN');
    expect(cb.isAllowed('svc-a')).toBe(false);
    expect(cb.getState('svc-b')).toBe('CLOSED');
    expect(cb.isAllowed('svc-b')).toBe(true);
  });

  it('reset restores circuit to CLOSED', () => {
    for (let i = 0; i < 5; i++) {
      cb.recordFailure('test');
    }
    expect(cb.getState('test')).toBe('OPEN');

    cb.reset('test');
    expect(cb.getState('test')).toBe('CLOSED');
    expect(cb.getFailureCount('test')).toBe(0);
    expect(cb.isAllowed('test')).toBe(true);
  });

  it('resetAll clears all circuits', () => {
    cb.recordFailure('svc-a');
    cb.recordFailure('svc-b');
    cb.resetAll();

    expect(cb.getState('svc-a')).toBe('CLOSED');
    expect(cb.getState('svc-b')).toBe('CLOSED');
  });

  it('getSnapshot returns all circuits', () => {
    cb.recordFailure('svc-a');
    const snapshot = cb.getSnapshot();
    expect(snapshot).toHaveProperty('svc-a');
    expect(snapshot['svc-a'].failureCount).toBe(1);
  });
});

// ── RetryPolicy ────────────────────────────────────────────────────

describe('RetryPolicy', () => {
  it('shouldRetryTask returns true for retryable task within limits', () => {
    const policy = new RetryPolicy();
    expect(policy.shouldRetryTask('fix_issue', new Error('timeout'), 1)).toBe(true);
    expect(policy.shouldRetryTask('fix_issue', new Error('timeout'), 2)).toBe(true);
    expect(policy.shouldRetryTask('fix_issue', new Error('timeout'), 3)).toBe(true);
  });

  it('shouldRetryTask returns false when max retries exceeded', () => {
    const policy = new RetryPolicy();
    expect(policy.shouldRetryTask('fix_issue', new Error('timeout'), 4)).toBe(false);
  });

  it('shouldRetryTask returns false for non-retryable errors', () => {
    const policy = new RetryPolicy();
    expect(policy.shouldRetryTask('fix_issue', new Error('Not found'), 1)).toBe(false);
    expect(policy.shouldRetryTask('fix_issue', new Error('Unauthorized'), 1)).toBe(false);
    expect(policy.shouldRetryTask('fix_issue', new Error('validation failed'), 1)).toBe(false);
  });

  it('uses default config for unknown task types', () => {
    const policy = new RetryPolicy();
    const config = policy.getConfig('unknown_task');
    expect(config.maxRetries).toBe(3);
    expect(config.retryable).toBe(true);
  });

  it('circuit breaker blocks retries when open', () => {
    const cb = new CircuitBreaker(2, 60_000);
    const policy = new RetryPolicy(undefined, cb);

    // Fail twice to open circuit
    cb.recordFailure('fix_issue');
    cb.recordFailure('fix_issue');

    expect(policy.shouldRetryTask('fix_issue', new Error('timeout'), 1)).toBe(false);
  });

  it('getDelay returns correct delay for task type', () => {
    const policy = new RetryPolicy();
    expect(policy.getDelay('fix_issue', 1)).toBe(1000);
    expect(policy.getDelay('fix_issue', 2)).toBe(4000);
    expect(policy.getDelay('fix_issue', 3)).toBe(16000);
  });

  it('registerTask adds new task configuration', () => {
    const policy = new RetryPolicy();
    policy.registerTask('new_task', {
      maxRetries: 5,
      baseDelayMs: 2000,
      multiplier: 2,
      retryable: true,
    });

    const config = policy.getConfig('new_task');
    expect(config.maxRetries).toBe(5);
    expect(config.baseDelayMs).toBe(2000);
  });

  it('getAllConfigs returns all configurations', () => {
    const policy = new RetryPolicy();
    const configs = policy.getAllConfigs();
    expect(configs).toHaveProperty('fix_issue');
    expect(configs).toHaveProperty('triage');
    expect(configs).toHaveProperty('sandbox');
  });
});
