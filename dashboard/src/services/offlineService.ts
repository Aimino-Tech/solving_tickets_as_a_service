const CACHE_PREFIX = 'syntaro_cache_';
const RETRY_QUEUE_KEY = 'syntaro_retry_queue';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  readonly data: T;
  readonly timestamp: number;
  readonly ttl: number;
}

export interface RetryRequest {
  readonly id: string;
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
  readonly timestamp: number;
}

function generateId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function setCache<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl: ttlMs };
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable
  }
}

export function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.timestamp > entry.ttl) {
      localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export function isCacheStale(key: string): boolean {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return true;

    const entry = JSON.parse(raw) as CacheEntry<unknown>;
    return Date.now() - entry.timestamp > entry.ttl;
  } catch {
    return true;
  }
}

export function removeCache(key: string): void {
  localStorage.removeItem(`${CACHE_PREFIX}${key}`);
}

export function clearAllCache(): void {
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith(CACHE_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

export function addToRetryQueue(request: Omit<RetryRequest, 'id' | 'timestamp'>): RetryRequest {
  const retryRequest: RetryRequest = {
    ...request,
    id: generateId(),
    timestamp: Date.now(),
  };

  try {
    const queue = getRetryQueue();
    queue.push(retryRequest);
    localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage unavailable
  }

  return retryRequest;
}

export function getRetryQueue(): RetryRequest[] {
  try {
    const raw = localStorage.getItem(RETRY_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RetryRequest[];
  } catch {
    return [];
  }
}

export function removeFromRetryQueue(id: string): void {
  try {
    const queue = getRetryQueue().filter((r) => r.id !== id);
    localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export function clearRetryQueue(): void {
  localStorage.removeItem(RETRY_QUEUE_KEY);
}

export async function processRetryQueue(): Promise<void> {
  const queue = getRetryQueue();
  if (queue.length === 0) return;

  const successfulIds: string[] = [];

  for (const request of queue) {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body ?? undefined,
      });
      await response.text(); // consume body to free connection

      if (response.ok) {
        await response.text();
        successfulIds.push(request.id);
      }
    } catch {
      // Still offline — keep in queue
    }
  }

  for (const id of successfulIds) {
    removeFromRetryQueue(id);
  }
}

export interface CachedFetchOptions extends RequestInit {
  readonly cacheKey?: string;
  readonly cacheTtlMs?: number;
  readonly offlineBehavior?: 'cache-first' | 'network-first';
}

export async function cachedFetch<T = unknown>(
  url: string,
  options: CachedFetchOptions = {},
): Promise<{ data: T; fromCache: boolean }> {
  const {
    cacheKey = url,
    cacheTtlMs = DEFAULT_TTL_MS,
    offlineBehavior = 'cache-first',
    ...fetchOptions
  } = options;

  if (offlineBehavior === 'network-first') {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok) {
        const data = (await response.json()) as T;
        setCache(cacheKey, data, cacheTtlMs);
        return { data, fromCache: false };
      }
    } catch {
      // Network failed — fall through to cache
    }

    const cached = getCache<T>(cacheKey);
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }
    throw new Error(`Network unavailable and no cache for ${cacheKey}`);
  }

  const cached = getCache<T>(cacheKey);
  if (cached !== null && !isCacheStale(cacheKey)) {
    return { data: cached, fromCache: true };
  }

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as T;
    setCache(cacheKey, data, cacheTtlMs);
    return { data, fromCache: false };
  } catch {
    // Network failed — try stale cache as fallback
    const stale = getCache<T>(cacheKey);
    if (stale !== null) {
      return { data: stale, fromCache: true };
    }
    throw new Error(`Network unavailable and no cache for ${cacheKey}`);
  }
}
