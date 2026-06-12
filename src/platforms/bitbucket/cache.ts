interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export const bitbucketCache = new TtlCache();

export const CACHE_TTL = {
  REPO_INFO: 5 * 60 * 1000,
  ISSUE_CONTENT: 30 * 1000,
  PR_INFO: 30 * 1000,
  USER_INFO: 5 * 60 * 1000,
} as const;
