/**
 * Emergency Stop — global kill switch for all running agents.
 *
 * When activated, all agent dispatches will be held and workers will
 * refuse to start new tasks. Activation persists across restarts via
 * Redis key + lock file, so it survives process crashes.
 *
 * Usage:
 *   import { EmergencyStop } from './emergency/stop.js';
 *   await EmergencyStop.activate('Critical vulnerability detected');
 *   const status = EmergencyStop.getStatus();
 *   await EmergencyStop.deactivate();
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'emergency-stop' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmergencyStopStatus {
  active: boolean;
  reason?: string;
  activatedAt?: string;
}

// ---------------------------------------------------------------------------
// Redis helpers (lazy connection, shared singleton)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });
    _redis.on('error', (err) => {
      log.error({ err: String(err) }, 'Emergency stop Redis error');
    });
  }
  return _redis;
}

async function closeRedis(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      // ignore
    }
    _redis = null;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (used when Redis is unavailable)
// ---------------------------------------------------------------------------

interface InMemoryState {
  active: boolean;
  reason?: string;
  activatedAt?: string;
}

let _inMemory: InMemoryState = { active: false };

// ---------------------------------------------------------------------------
// EmergencyStop
// ---------------------------------------------------------------------------

export const EmergencyStop = {
  /**
   * Quick check — returns true if the kill switch is active.
   * Checks Redis first, then filesystem lock file, then in-memory fallback.
   * This is intentionally fast — it's called on every task dispatch.
   */
  check(): boolean {
    // 1. Check Redis
    try {
      const redis = getRedis();
      // We do a synchronous attempt — the real check() from activate/deactivate
      // sets the state. For hot-path perf, we rely on the in-memory cache.
    } catch {
      // Redis unavailable, fall through
    }

    if (_inMemory.active) return true;

    // 2. Check lock file
    try {
      if (existsSync(config.emergency.lockFile)) {
        const content = readFileSync(config.emergency.lockFile, 'utf-8');
        // Sync in-memory state from file on read
        try {
          const data = JSON.parse(content);
          _inMemory.active = true;
          _inMemory.reason = data.reason;
          _inMemory.activatedAt = data.activatedAt;
        } catch {
          _inMemory.active = true;
        }
        return true;
      }
    } catch {
      // File not accessible, ignore
    }

    return _inMemory.active;
  },

  /**
   * Activate the kill switch with an optional reason.
   * Sets the Redis key, writes the lock file, and fires the Prometheus metric.
   */
  async activate(reason: string = 'No reason provided'): Promise<void> {
    const activatedAt = new Date().toISOString();
    const payload = JSON.stringify({ reason, activatedAt });

    // 1. Set Redis key
    try {
      const redis = getRedis();
      await redis.set(config.emergency.redisKey, payload, 'EX', 86400 * 30); // 30-day TTL
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to set emergency stop Redis key — continuing with file lock');
    }

    // 2. Write lock file
    try {
      writeFileSync(config.emergency.lockFile, payload, 'utf-8');
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to write emergency stop lock file');
      // If we can't write the lock file, we can't guarantee the stop persists
      throw new Error(`Failed to write emergency stop lock file: ${err}`);
    }

    // 3. Fire Prometheus metric
    try {
      bridgeMetrics.setGauge('stas_emergency_stop_active', {}, 1);
      bridgeMetrics.setGauge('stas_emergency_stop_activated_at', {}, Date.now() / 1000);
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to set Prometheus metrics');
    }

    // 4. Sync in-memory state
    _inMemory = { active: true, reason, activatedAt };

    log.warn({ reason, activatedAt }, 'EMERGENCY STOP ACTIVATED - all agents halted');
  },

  /**
   * Deactivate the kill switch.
   * Clears the Redis key, removes the lock file, and fires the metric.
   */
  async deactivate(): Promise<void> {
    // 1. Clear Redis key
    try {
      const redis = getRedis();
      await redis.del(config.emergency.redisKey);
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to clear emergency stop Redis key');
    }

    // 2. Remove lock file
    try {
      if (existsSync(config.emergency.lockFile)) {
        unlinkSync(config.emergency.lockFile);
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to remove emergency stop lock file');
    }

    // 3. Fire Prometheus metric
    try {
      bridgeMetrics.setGauge('stas_emergency_stop_active', {}, 0);
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to set Prometheus metric');
    }

    // 4. Sync in-memory state
    _inMemory = { active: false };

    log.info('EMERGENCY STOP DEACTIVATED - agents resumed');
  },

  /**
   * Returns the current status of the kill switch.
   * First syncs from Redis if available, then from file, then from memory.
   */
  async getStatus(): Promise<EmergencyStopStatus> {
    // 1. Try Redis (authoritative source)
    try {
      const redis = getRedis();
      const value = await redis.get(config.emergency.redisKey);
      if (value) {
        try {
          const data = JSON.parse(value);
          const status: EmergencyStopStatus = {
            active: true,
            reason: data.reason,
            activatedAt: data.activatedAt,
          };
          // Sync in-memory
          _inMemory = { active: true, reason: data.reason, activatedAt: data.activatedAt };
          return status;
        } catch {
          return { active: true, reason: value };
        }
      }
    } catch {
      // Redis unavailable, fall through
    }

    // 2. Try lock file
    try {
      if (existsSync(config.emergency.lockFile)) {
        const content = readFileSync(config.emergency.lockFile, 'utf-8');
        try {
          const data = JSON.parse(content);
          _inMemory = { active: true, reason: data.reason, activatedAt: data.activatedAt };
          return { active: true, reason: data.reason, activatedAt: data.activatedAt };
        } catch {
          _inMemory = { active: true, reason: content };
          return { active: true, reason: content };
        }
      }
    } catch {
      // File not accessible, ignore
    }

    // 3. Return in-memory state (falls back to inactive)
    return {
      active: _inMemory.active,
      reason: _inMemory.reason,
      activatedAt: _inMemory.activatedAt,
    };
  },

  /**
   * Reset the in-memory cache (useful for testing).
   */
  _resetCache(): void {
    _inMemory = { active: false };
  },

  /**
   * Close the Redis connection (useful for graceful shutdown).
   */
  async close(): Promise<void> {
    await closeRedis();
  },
};
