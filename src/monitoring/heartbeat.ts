/**
 * Worker Heartbeat Monitor — tracks worker liveness via Redis.
 *
 * Uses Redis keys with TTL to track which workers are alive.
 * Heartbeat keys are stored at `stas:heartbeat:{workerId}` with a 30s TTL.
 * A periodic monitor checks for dead workers and emits events.
 *
 * Usage:
 *   const monitor = new WorkerHeartbeatMonitor();
 *   await monitor.heartbeat('worker-1');
 *   const live = await monitor.getLiveWorkers();
 *   const dead = await monitor.isWorkerDead('worker-2');
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import { EventEmitter } from 'node:events';

const log = rootLogger.child({ module: 'heartbeat-monitor' });

// ── Constants ───────────────────────────────────────────────────────

const HEARTBEAT_PREFIX = 'stas:heartbeat:';
const HEARTBEAT_TTL_SECONDS = 30; // TTL for heartbeat keys
const DEAD_AFTER_MS = 60_000; // Worker is dead if no heartbeat for 60s

// ── Types ───────────────────────────────────────────────────────────

export interface HeartbeatEvent {
  workerId: string;
  timestamp: string;
}

// ── WorkerHeartbeatMonitor ──────────────────────────────────────────

export class WorkerHeartbeatMonitor {
  private readonly redis: Redis;
  private readonly emitter: EventEmitter;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Events:
   *   - 'heartbeat' (event: HeartbeatEvent) — emitted when a heartbeat is recorded
   *   - 'deadWorker' (event: HeartbeatEvent) — emitted when a worker is detected as dead
   *   - 'workerRevived' (event: HeartbeatEvent) — emitted when a previously dead worker comes back
   */
  get events(): EventEmitter {
    return this.emitter;
  }

  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl ?? config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, 'Heartbeat Redis connection retry in ${delay}ms');
        return delay;
      },
      lazyConnect: true,
    });
    this.emitter = new EventEmitter();

    // Mark the redis for monitoring
    this.redis.on('error', (err) => {
      log.error({ err: String(err) }, 'Heartbeat Redis error');
    });
  }

  /**
   * Record a heartbeat from a worker.
   * Sets/refreshes the TTL on `stas:heartbeat:{workerId}`.
   */
  async heartbeat(workerId: string): Promise<void> {
    try {
      const key = `${HEARTBEAT_PREFIX}${workerId}`;
      await this.redis.set(key, Date.now().toString(), 'EX', HEARTBEAT_TTL_SECONDS);
      log.debug({ workerId }, 'Heartbeat recorded');
    } catch (err) {
      log.error({ err: String(err), workerId }, 'Failed to record heartbeat');
    }
  }

  /**
   * Get all workers with recent heartbeats (within TTL).
   */
  async getLiveWorkers(): Promise<string[]> {
    try {
      // Ensure connection
      if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
        await this.redis.connect().catch(() => {});
      }

      const keys = await this.redis.keys(`${HEARTBEAT_PREFIX}*`);
      return keys.map((key) => key.replace(HEARTBEAT_PREFIX, ''));
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to get live workers');
      return [];
    }
  }

  /**
   * Check if a worker is dead (no heartbeat for > 60s).
   */
  async isWorkerDead(workerId: string): Promise<boolean> {
    try {
      const key = `${HEARTBEAT_PREFIX}${workerId}`;
      const exists = await this.redis.exists(key);
      if (!exists) {
        return true; // No heartbeat key = dead
      }

      const lastHeartbeat = await this.redis.get(key);
      if (!lastHeartbeat) {
        return true;
      }

      const elapsed = Date.now() - parseInt(lastHeartbeat, 10);
      return elapsed > DEAD_AFTER_MS;
    } catch (err) {
      log.error({ err: String(err), workerId }, 'Failed to check worker liveness');
      return true; // Assume dead on error
    }
  }

  /**
   * Start periodic monitoring for dead workers.
   * Checks all live workers at the given interval.
   * Emits 'deadWorker' events when a worker is found dead.
   */
  startMonitor(intervalMs: number = 15_000): void {
    if (this.monitorInterval) {
      log.warn('Heartbeat monitor already running');
      return;
    }

    log.info({ intervalMs }, 'Starting heartbeat monitor');

    this.monitorInterval = setInterval(async () => {
      try {
        const liveWorkers = await this.getLiveWorkers();
        log.debug({ workerCount: liveWorkers.length, workers: liveWorkers }, 'Heartbeat monitor check');

        for (const workerId of liveWorkers) {
          const dead = await this.isWorkerDead(workerId);
          if (dead) {
            const event: HeartbeatEvent = {
              workerId,
              timestamp: new Date().toISOString(),
            };
            log.warn({ workerId }, 'Dead worker detected via heartbeat monitor');
            this.emitter.emit('deadWorker', event);
            bridgeMetrics.incrementCounter('stas_dead_workers_total', { workerId });
          }
        }

        // Set gauge for live worker count
        bridgeMetrics.setGauge('stas_live_workers', {}, liveWorkers.length);
      } catch (err) {
        log.error({ err: String(err) }, 'Heartbeat monitor check failed');
      }
    }, intervalMs);

    // Allow the process to exit even if the interval is still running
    if (this.monitorInterval && typeof this.monitorInterval === 'object' && 'unref' in this.monitorInterval) {
      this.monitorInterval.unref();
    }
  }

  /**
   * Stop the periodic monitor.
   */
  stopMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      log.info('Heartbeat monitor stopped');
    }
  }

  /**
   * Close the Redis connection.
   */
  async close(): Promise<void> {
    this.stopMonitor();
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
    log.info('Heartbeat monitor Redis connection closed');
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global worker heartbeat monitor instance.
 */
export const workerHeartbeatMonitor = new WorkerHeartbeatMonitor();

/**
 * Convenience: start heartbeat monitor with default interval.
 */
export function startHeartbeatMonitor(intervalMs: number = 15_000): WorkerHeartbeatMonitor {
  workerHeartbeatMonitor.startMonitor(intervalMs);
  return workerHeartbeatMonitor;
}
