/**
 * In-process per-account concurrency limiter for the fix queue consumer.
 * Tracks how many jobs are currently being dispatched per account key so a
 * single account cannot saturate the worker. Release on a never-acquired key
 * is a safe no-op, which lets callers attach a `finally` without tracking
 * whether acquisition succeeded.
 */
export class ConcurrencyLimiter {
  private counts = new Map<string, number>();

  acquire(key: string, max: number): boolean {
    const current = this.counts.get(key) ?? 0;
    if (current >= max) {
      return false;
    }
    this.counts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, current - 1);
    }
  }

  currentCount(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  reset(): void {
    this.counts.clear();
  }
}

export const perAccountConcurrency = new ConcurrencyLimiter();
