import { describe, it, expect, afterEach } from 'vitest';
import { AccountConcurrencyLimiter, resetAccountConcurrencyLimiter } from '../../queue/accountConcurrency.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  resetAccountConcurrencyLimiter();
});

describe('AccountConcurrencyLimiter (AIM-4496)', () => {
  it('allows concurrent runs up to the per-account limit', async () => {
    const limiter = new AccountConcurrencyLimiter(2);
    let inFlight = 0;
    let maxInFlight = 0;

    const task = async () => {
      await limiter.withSlot('acct-1', async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight -= 1;
      });
    };

    await Promise.all([task(), task(), task(), task()]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(await limiter.activeCount('acct-1')).toBe(0);
  });

  it('queues the 3rd concurrent run until a slot frees (3rd rejected/blocked)', async () => {
    const limiter = new AccountConcurrencyLimiter(2);
    const order: number[] = [];
    const release = [
      () => limiter.release('acct-1'),
      () => limiter.release('acct-1'),
    ];

    await limiter.acquire('acct-1');
    await limiter.acquire('acct-1');

    const third = limiter.acquire('acct-1').then(() => {
      order.push(3);
      limiter.release('acct-1');
    });

    await delay(30);
    expect(order).toEqual([]);
    expect(await limiter.activeCount('acct-1')).toBe(2);

    release[0]();
    await delay(10);
    expect(order).toEqual([3]);
    release[1]();
  });

  it('different accounts are independent', async () => {
    const limiter = new AccountConcurrencyLimiter(1);
    await limiter.acquire('acct-a');
    await limiter.acquire('acct-b');
    expect(await limiter.activeCount('acct-a')).toBe(1);
    expect(await limiter.activeCount('acct-b')).toBe(1);
    limiter.release('acct-a');
    limiter.release('acct-b');
  });

  it('release after failure still frees the slot', async () => {
    const limiter = new AccountConcurrencyLimiter(1);
    await expect(
      limiter.withSlot('acct-1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await limiter.activeCount('acct-1')).toBe(0);
    await limiter.acquire('acct-1');
    limiter.release('acct-1');
  });
});
