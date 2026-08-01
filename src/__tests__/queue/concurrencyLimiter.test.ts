import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter, perAccountConcurrency } from '../../queue/concurrencyLimiter.js';

describe('ConcurrencyLimiter', () => {
  it('allows acquires up to the max, then rejects', () => {
    const limiter = new ConcurrencyLimiter();
    expect(limiter.acquire('account-a', 2)).toBe(true);
    expect(limiter.acquire('account-a', 2)).toBe(true);
    expect(limiter.acquire('account-a', 2)).toBe(false);
    expect(limiter.currentCount('account-a')).toBe(2);
  });

  it('releases a slot', () => {
    const limiter = new ConcurrencyLimiter();
    expect(limiter.acquire('account-a', 2)).toBe(true);
    expect(limiter.acquire('account-a', 2)).toBe(true);
    limiter.release('account-a');
    expect(limiter.acquire('account-a', 2)).toBe(true);
    expect(limiter.currentCount('account-a')).toBe(2);
  });

  it('tracks accounts independently', () => {
    const limiter = new ConcurrencyLimiter();
    expect(limiter.acquire('account-a', 1)).toBe(true);
    expect(limiter.acquire('account-b', 1)).toBe(true);
    expect(limiter.acquire('account-b', 1)).toBe(false);
    expect(limiter.currentCount('account-a')).toBe(1);
    expect(limiter.currentCount('account-b')).toBe(1);
  });

  it('reset clears all counts', () => {
    const limiter = new ConcurrencyLimiter();
    limiter.acquire('account-a', 1);
    limiter.acquire('account-b', 1);
    limiter.reset();
    expect(limiter.currentCount('account-a')).toBe(0);
    expect(limiter.currentCount('account-b')).toBe(0);
    expect(limiter.acquire('account-a', 1)).toBe(true);
  });

  it('release on a never-acquired key is a safe no-op', () => {
    const limiter = new ConcurrencyLimiter();
    expect(() => limiter.release('unknown-account')).not.toThrow();
    expect(limiter.currentCount('unknown-account')).toBe(0);
  });

  it('deletes the key when the last slot is released', () => {
    const limiter = new ConcurrencyLimiter();
    limiter.acquire('account-a', 1);
    limiter.release('account-a');
    expect(limiter.currentCount('account-a')).toBe(0);
    expect(limiter.acquire('account-a', 1)).toBe(true);
  });

  it('exposes the shared singleton', () => {
    expect(perAccountConcurrency).toBeInstanceOf(ConcurrencyLimiter);
  });
});
