/**
 * Redis per-repo lock via SETNX.
 *
 * Prevents concurrent PR creation for the same repository.
 *
 * ── Key format ───────────────────────────────────────────────────────
 *   stas:lock:{owner}:{name}  →  pipelineId (owner identifier)
 * ─────────────────────────────────────────────────────────────────────
 *
 * ── Lua release script ──────────────────────────────────────────────
 * Atomically checks ownership before deleting the lock:
 *   if redis.call("GET", KEYS[1]) == ARGV[1] then
 *     return redis.call("DEL", KEYS[1])
 *   end
 *   return 0
 * ─────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'repo-lock' });

const KEY_PREFIX = 'stas:lock';

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function lockKey(owner: string, name: string): string {
  return `${KEY_PREFIX}:${owner}:${name}`;
}

export class RepoLock {
  private readonly redis: Redis;
  private releaseSha: string | null = null;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, 'RepoLock Redis retry in ${delay}ms');
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('error', (err: Error) => {
      log.error({ err: String(err) }, 'RepoLock Redis connection error');
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
      await this.redis.connect();
    }
  }

  private async getReleaseSha(): Promise<string> {
    if (!this.releaseSha) {
      const sha = await this.redis.script('LOAD', RELEASE_SCRIPT);
      this.releaseSha = typeof sha === 'string' ? sha : null;
    }
    return this.releaseSha ?? '';
  }

  /**
   * Acquire a lock for a repository. Returns true if the lock was acquired.
   *
   * @param owner - Repository owner (user/org)
   * @param name - Repository name
   * @param pipelineId - Unique identifier for the pipeline that holds the lock
   * @param ttlMs - Lock TTL in ms (default: 30_000)
   */
  async acquire(
    owner: string,
    name: string,
    pipelineId: string,
    ttlMs: number = 30_000,
  ): Promise<boolean> {
    try {
      await this.ensureConnected();
      const key = lockKey(owner, name);
      const result = await this.redis.set(key, pipelineId, 'PX', ttlMs, 'NX');
      const acquired = result === 'OK';
      if (acquired) {
        log.info({ owner, name, pipelineId }, 'Repo lock acquired');
      } else {
        log.warn({ owner, name, pipelineId }, 'Repo lock already held');
      }
      return acquired;
    } catch (err) {
      log.error({ err: String(err), owner, name }, 'RepoLock.acquire failed');
      return false;
    }
  }

  /**
   * Release a lock. Only succeeds if the caller owns the lock (pipelineId matches).
   */
  async release(owner: string, name: string, pipelineId: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const key = lockKey(owner, name);
      const sha = await this.getReleaseSha();
      const result = (await this.redis.evalsha(sha, 1, key, pipelineId)) as number;
      const released = result === 1;
      if (released) {
        log.info({ owner, name, pipelineId }, 'Repo lock released');
      } else {
        log.warn({ owner, name, pipelineId }, 'Repo lock release failed (not owner or not locked)');
      }
      return released;
    } catch (err) {
      log.error({ err: String(err), owner, name }, 'RepoLock.release failed');
      return false;
    }
  }

  /**
   * Check if a repository is currently locked.
   */
  async isLocked(owner: string, name: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const key = lockKey(owner, name);
      const ttl = await this.redis.pttl(key);
      return ttl > 0;
    } catch (err) {
      log.error({ err: String(err), owner, name }, 'RepoLock.isLocked failed');
      return false;
    }
  }

  /**
   * Get the current lock owner (pipelineId) if locked.
   */
  async getLockOwner(owner: string, name: string): Promise<string | null> {
    try {
      await this.ensureConnected();
      const key = lockKey(owner, name);
      return await this.redis.get(key);
    } catch (err) {
      log.error({ err: String(err), owner, name }, 'RepoLock.getLockOwner failed');
      return null;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing RepoLock Redis');
    }
  }
}
