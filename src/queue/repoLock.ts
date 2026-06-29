import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'repo-lock' });

const locks = new Map<string, { acquiredAt: number; ttl: number }>();

export async function acquireRepoLock(key: string, ttlMs: number): Promise<boolean> {
  const now = Date.now();

  const existing = locks.get(key);
  if (existing) {
    if ((now - existing.acquiredAt) < existing.ttl) {
      log.debug({ key, expiresIn: existing.ttl - (now - existing.acquiredAt) }, 'Repo lock already held');
      return false;
    }
    locks.delete(key);
  }

  locks.set(key, { acquiredAt: now, ttl: ttlMs });
  log.debug({ key, ttlMs }, 'Repo lock acquired');
  bridgeMetrics.setGauge('repo_locks_active', { key }, locks.size);
  return true;
}

export async function releaseRepoLock(key: string): Promise<void> {
  locks.delete(key);
  log.debug({ key }, 'Repo lock released');
  bridgeMetrics.setGauge('repo_locks_active', { key }, locks.size);
}

export function clearExpiredLocks(): number {
  const now = Date.now();
  let cleared = 0;
  for (const [key, lock] of locks) {
    if ((now - lock.acquiredAt) >= lock.ttl) {
      locks.delete(key);
      cleared++;
    }
  }
  if (cleared > 0) {
    log.info({ cleared }, 'Expired repo locks cleared');
  }
  return cleared;
}

export function getActiveLockCount(): number {
  return locks.size;
}

export function clearAllLocks(): void {
  locks.clear();
  log.info('All repo locks cleared');
}

