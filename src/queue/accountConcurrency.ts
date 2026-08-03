interface AccountState {
  active: number;
  waiting: Array<() => void>;
}

/**
 * Per-account concurrency limiter (AIM-4496).
 *
 * Limits how many fix runs may be in-flight for the same account
 * (installationId) at once. When an account is at its limit, additional
 * acquires queue and resolve FIFO as earlier runs release their slot.
 */
export class AccountConcurrencyLimiter {
  private readonly maxPerAccount: number;
  private readonly accounts = new Map<string, AccountState>();

  constructor(maxPerAccount = 2) {
    this.maxPerAccount = Math.max(1, maxPerAccount);
  }

  /**
   * Resolve a per-account override or the default. Tiers may raise the cap.
   */
  maxFor(accountId: string): number {
    const override = this.resolveOverride(accountId);
    if (override !== undefined) return override;
    return this.maxPerAccount;
  }

  /**
   * Acquire a concurrency slot for an account. Resolves immediately when the
   * account is under its limit, otherwise waits until a slot frees up.
   */
  async acquire(accountId: string): Promise<void> {
    const max = this.maxFor(accountId);
    const state = this.getOrCreate(accountId);

    if (state.active < max) {
      state.active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      state.waiting.push(resolve);
    });
  }

  /**
   * Release a concurrency slot, waking the next waiting acquire (FIFO).
   */
  release(accountId: string): void {
    const state = this.accounts.get(accountId);
    if (!state) return;

    state.active = Math.max(0, state.active - 1);

    const next = state.waiting.shift();
    if (next) {
      state.active += 1;
      next();
    } else if (state.active === 0) {
      this.accounts.delete(accountId);
    }
  }

  /**
   * Run fn while holding a per-account concurrency slot, releasing it when fn
   * settles (success or failure).
   */
  async withSlot<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(accountId);
    try {
      return await fn();
    } finally {
      this.release(accountId);
    }
  }

  activeCount(accountId: string): number {
    return this.accounts.get(accountId)?.active ?? 0;
  }

  private getOrCreate(accountId: string): AccountState {
    let state = this.accounts.get(accountId);
    if (!state) {
      state = { active: 0, waiting: [] };
      this.accounts.set(accountId, state);
    }
    return state;
  }

  private resolveOverride(accountId: string): number | undefined {
    const overrides = configOverrides();
    for (const [pattern, max] of Object.entries(overrides)) {
      if (pattern === accountId || (pattern.includes('*') && accountId.startsWith(pattern.replace('*', '')))) {
        return Math.max(1, max);
      }
    }
    return undefined;
  }
}

function configOverrides(): Record<string, number> {
  const raw = process.env.STAS_PER_ACCOUNT_CONCURRENCY_OVERRIDES || '';
  const result: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = Number(part.slice(eqIdx + 1).trim());
    if (key && Number.isInteger(value) && value > 0) result[key] = value;
  }
  return result;
}

export const accountConcurrencyLimiter = new AccountConcurrencyLimiter(
  Number(process.env.STAS_PER_ACCOUNT_CONCURRENCY) || 2,
);

export function getMaxConcurrency(): number {
  return Number(process.env.STAS_PER_ACCOUNT_CONCURRENCY) || 2;
}

export function getActiveAccountCount(): number {
  return accountConcurrencyLimiter['accounts'].size;
}

export function resetAccountConcurrencyLimiter(): void {
  accountConcurrencyLimiter['accounts'].clear();
}
