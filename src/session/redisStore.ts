/**
 * Redis-backed session store.
 *
 * Implements the same SessionStore interface as InMemorySessionStore but
 * persists sessions in Redis with heartbeat TTL (30s) and a zombie reaper
 * that marks stale sessions.
 *
 * ── Key format ───────────────────────────────────────────────────────
 *   stas:session:{sessionId}        → Hash (SessionState fields)
 *   stas:session:{sessionId}:events → List (SessionEvent JSON)
 *   stas:session:zombie:{sessionId} → String (zombie marker)
 * ─────────────────────────────────────────────────────────────────────
 *
 * ── Heartbeat ────────────────────────────────────────────────────────
 * Every read/write operation refreshes the TTL to 30s via PEXPIRE.
 * ─────────────────────────────────────────────────────────────────────
 *
 * ── Zombie Reaper ───────────────────────────────────────────────────
 * Background interval scans sessions for stale entries (TTL near expiry)
 * and marks them as zombie by writing a zombie flag and logging an event.
 * ─────────────────────────────────────────────────────────────────────
 */

import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { rootLogger } from '../utils/logger.js';
import type { SessionEvent, SessionState } from '../pipeline/types.js';
import type { SessionStore } from '../pipeline/sessionOrchestrator.js';

const log = rootLogger.child({ module: 'redis-session-store' });

// ── Constants ───────────────────────────────────────────────────────

/** TTL for session heartbeats (30s). */
const SESSION_TTL_MS = 30_000;

/** How often the zombie reaper scans (10s). */
const REAPER_INTERVAL_MS = 10_000;

/** TTL threshold below which a session is considered a zombie candidate. */
const ZOMBIE_TTL_THRESHOLD_MS = 5_000;

const KEY_PREFIX = 'stas:session:';
const ZOMBIE_PREFIX = 'stas:session:zombie:';

// ── Helper ──────────────────────────────────────────────────────────

function sessionKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function eventsKey(id: string): string {
  return `${KEY_PREFIX}${id}:events`;
}

function zombieKey(id: string): string {
  return `${ZOMBIE_PREFIX}${id}`;
}

/**
 * Serialize a SessionState into a record suitable for Redis HSET.
 */
function serializeState(state: SessionState): Record<string, string> {
  return {
    sessionId: state.sessionId,
    issueId: state.issueId,
    pipelineName: state.pipelineName,
    status: state.status,
    currentStage: state.currentStage,
    progress: String(state.progress),
    attempt: String(state.attempt),
    maxAttempts: String(state.maxAttempts),
    createdAt: String(state.createdAt),
    updatedAt: String(state.updatedAt),
    startedAt: state.startedAt !== undefined ? String(state.startedAt) : '',
    completedAt: state.completedAt !== undefined ? String(state.completedAt) : '',
    error: state.error ?? '',
    metadata: JSON.stringify(state.metadata),
  };
}

/**
 * Deserialize a Redis hash back into a SessionState.
 */
function deserializeState(data: Record<string, string>): SessionState {
  return {
    sessionId: data.sessionId,
    issueId: data.issueId,
    pipelineName: data.pipelineName,
    status: data.status as SessionState['status'],
    currentStage: data.currentStage as SessionState['currentStage'],
    progress: Number(data.progress),
    attempt: Number(data.attempt),
    maxAttempts: Number(data.maxAttempts),
    createdAt: Number(data.createdAt),
    updatedAt: Number(data.updatedAt),
    startedAt: data.startedAt ? Number(data.startedAt) : undefined,
    completedAt: data.completedAt ? Number(data.completedAt) : undefined,
    error: data.error || undefined,
    metadata: data.metadata ? JSON.parse(data.metadata) : {},
  };
}

// ── RedisSessionStore ───────────────────────────────────────────────

export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private readonly ttlMs: number;
  private readonly prefix: string;

  constructor(
    redisUrl: string,
    options?: {
      ttlMs?: number;
      keyPrefix?: string;
    },
  ) {
    this.ttlMs = options?.ttlMs ?? SESSION_TTL_MS;
    this.prefix = options?.keyPrefix ?? 'stas';

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `RedisSessionStore retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('error', (err: Error) => {
      log.error({ err: String(err) }, 'RedisSessionStore connection error');
    });

    log.info('RedisSessionStore created');
  }

  // ── Connect / Close ───────────────────────────────────────────────

  async connect(): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
      await this.redis.connect();
      log.info('RedisSessionStore connected');
    }
  }

  async close(): Promise<void> {
    this.stopZombieReaper();
    try {
      await this.redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing RedisSessionStore');
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────

  private async refreshTTL(id: string): Promise<void> {
    try {
      await this.redis.pexpire(sessionKey(id), this.ttlMs);
    } catch (err) {
      log.warn({ err: String(err), sessionId: id }, 'Failed to refresh session TTL');
    }
  }

  // ── SessionStore implementation ───────────────────────────────────

  async get(id: string): Promise<SessionState | undefined> {
    try {
      await this.connect();
      const data = await this.redis.hgetall(sessionKey(id));
      if (!data || Object.keys(data).length === 0) {
        return undefined;
      }
      // Heartbeat
      await this.refreshTTL(id);
      return deserializeState(data as Record<string, string>);
    } catch (err) {
      log.error({ err: String(err), sessionId: id }, 'RedisSessionStore.get failed');
      return undefined;
    }
  }

  async set(id: string, state: SessionState): Promise<void> {
    try {
      await this.connect();
      const serialized = serializeState(state);
      await this.redis.hset(sessionKey(id), serialized);
      await this.refreshTTL(id);
    } catch (err) {
      log.error({ err: String(err), sessionId: id }, 'RedisSessionStore.set failed');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.connect();
      const key = sessionKey(id);
      const evKey = eventsKey(id);
      const result = await this.redis.del(key, evKey);
      return result > 0;
    } catch (err) {
      log.error({ err: String(err), sessionId: id }, 'RedisSessionStore.delete failed');
      return false;
    }
  }

  async list(filter?: { status?: string; issueId?: string }): Promise<SessionState[]> {
    try {
      await this.connect();
      let cursor = '0';
      const sessions: SessionState[] = [];
      const pattern = `${this.prefix}:session:*`;

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        // Filter out event list keys and zombie keys — only process session hashes
        const sessionKeys = keys.filter(
          (k: string) => !k.endsWith(':events') && !k.startsWith(ZOMBIE_PREFIX),
        );

        if (sessionKeys.length === 0) continue;

        const pipeline = this.redis.pipeline();
        for (const sk of sessionKeys) {
          pipeline.hgetall(sk);
        }
        const results = await pipeline.exec();

        if (!results) continue;

        for (const [, result] of results) {
          if (!result || typeof result !== 'object') continue;
          const data = result as Record<string, string>;
          if (!data.sessionId) continue;
          const state = deserializeState(data);

          if (filter?.status && state.status !== filter.status) continue;
          if (filter?.issueId && state.issueId !== filter.issueId) continue;

          sessions.push(state);
        }
      } while (cursor !== '0');

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      log.error({ err: String(err) }, 'RedisSessionStore.list failed');
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      await this.connect();
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.prefix}:session:*`,
          'COUNT',
          200,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      log.error({ err: String(err) }, 'RedisSessionStore.clear failed');
    }
  }

  async getEvents(sessionId: string, limit: number = 50): Promise<SessionEvent[]> {
    try {
      await this.connect();
      const key = eventsKey(sessionId);
      const raw = await this.redis.lrange(key, -limit, -1);
      return raw
        .map((r: string) => {
          try {
            return JSON.parse(r) as SessionEvent;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as SessionEvent[];
    } catch (err) {
      log.error({ err: String(err), sessionId }, 'RedisSessionStore.getEvents failed');
      return [];
    }
  }

  async addEvent(sessionId: string, event: SessionEvent): Promise<void> {
    try {
      await this.connect();
      const key = eventsKey(sessionId);
      const pipeline = this.redis.pipeline();
      pipeline.rpush(key, JSON.stringify(event));
      pipeline.ltrim(key, -200, -1);
      pipeline.pexpire(key, this.ttlMs);
      await pipeline.exec();
    } catch (err) {
      log.error({ err: String(err), sessionId }, 'RedisSessionStore.addEvent failed');
    }
  }

  // ── Zombie Reaper ─────────────────────────────────────────────────

  /**
   * Start the zombie reaper background interval.
   * Scans for stale sessions (those with TTL below threshold) and marks
   * them by writing a zombie flag.
   */
  startZombieReaper(): void {
    if (this.reaperTimer) return;
    log.info('Starting zombie reaper (interval=%dms)', REAPER_INTERVAL_MS);
    this.reaperTimer = setInterval(() => {
      this.reapZombies().catch((err) => {
        log.warn({ err: String(err) }, 'Zombie reaper cycle failed');
      });
    }, REAPER_INTERVAL_MS);
  }

  /**
   * Stop the zombie reaper.
   */
  stopZombieReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  private async reapZombies(): Promise<void> {
    try {
      let cursor = '0';
      const pattern = `${this.prefix}:session:*`;

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        const sessionKeys = keys.filter(
          (k: string) => !k.endsWith(':events') && !k.startsWith(ZOMBIE_PREFIX),
        );

        for (const sk of sessionKeys) {
          const pttl = await this.redis.pttl(sk);
          // pttl returns -1 if no expiry, -2 if key doesn't exist
          if (pttl > 0 && pttl < ZOMBIE_TTL_THRESHOLD_MS) {
            const sessionId = sk.slice(sessionKey('').length);
            try {
              // Mark as zombie
              await this.redis.set(zombieKey(sessionId), '1', 'PX', this.ttlMs);

              // Add a zombie event
              const event: SessionEvent = {
                event: 'session.zombie',
                timestamp: Date.now(),
                sessionId,
                stage: 'failed',
                data: { reason: 'session heartbeat expired' },
              };
              await this.addEvent(sessionId, event);

              log.warn({ sessionId, ttlMs: pttl }, 'Session marked as zombie (heartbeat expired)');
            } catch (innerErr) {
              log.warn({ err: String(innerErr), sessionId }, 'Failed to mark zombie session');
            }
          }
        }
      } while (cursor !== '0');
    } catch (err) {
      log.error({ err: String(err) }, 'Zombie reaper scan error');
    }
  }

  /**
   * Check if a session has been marked as zombie.
   */
  async isZombie(sessionId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(zombieKey(sessionId));
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Return the raw Redis client (for advanced operations / testing).
   */
  getClient(): Redis {
    return this.redis;
  }
}
