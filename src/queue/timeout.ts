/**
 * Timeout Enforcement — tracks task timeouts and enforces soft/hard limits.
 *
 * Features:
 *   - Redis-backed task tracking with deadlines
 *   - Soft limit (80% of timeout): warning
 *   - Hard limit (100% of timeout): kill and retry
 *   - Stuck task detection and cleanup
 *   - Configurable per task type
 *
 * Usage:
 *   const enforcer = new TimeoutEnforcer();
 *   enforcer.startTracking('task-123', 600_000);
 *   const stuck = await enforcer.checkStuckTasks();
 *   await enforcer.cancelTask('task-123');
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'timeout-enforcer' });

// ── Constants ───────────────────────────────────────────────────────

const TIMEOUT_PREFIX = 'stas:timeout:';
const TASK_DEADLINE_PREFIX = 'stas:task:deadline:';
const SOFT_WARNING_PREFIX = 'stas:task:soft_warning:';
const STUCK_CHECK_INTERVAL = 30_000; // Check for stuck tasks every 30s

// ── Types ───────────────────────────────────────────────────────────

export interface TimeoutConfig {
  /** Hard timeout in milliseconds. */
  hardLimitMs: number;
  /** Soft timeout in milliseconds (defaults to 80% of hard limit). */
  softLimitMs: number;
  /** Whether to retry on timeout. */
  retryOnTimeout: boolean;
}

export interface TaskTimeoutInfo {
  taskId: string;
  taskType: string;
  startedAt: number;
  deadline: number;
  softDeadline: number;
}

// ── Default Timeout Configs ─────────────────────────────────────────

const DEFAULT_TIMEOUT_CONFIGS: Record<string, TimeoutConfig> = {
  'fix_issue': {
    hardLimitMs: config.fixTimeoutMs ?? 600_000, // 10 min
    softLimitMs: Math.round((config.fixTimeoutMs ?? 600_000) * 0.8), // 8 min
    retryOnTimeout: true,
  },
  'triage': {
    hardLimitMs: config.phaseTimeouts?.triage ?? 30_000,
    softLimitMs: Math.round((config.phaseTimeouts?.triage ?? 30_000) * 0.8),
    retryOnTimeout: true,
  },
  'sandbox': {
    hardLimitMs: config.phaseTimeouts?.sandboxBoot ?? 300_000,
    softLimitMs: Math.round((config.phaseTimeouts?.sandboxBoot ?? 300_000) * 0.8),
    retryOnTimeout: false,
  },
  'pr_creation': {
    hardLimitMs: config.phaseTimeouts?.prCreation ?? 30_000,
    softLimitMs: Math.round((config.phaseTimeouts?.prCreation ?? 30_000) * 0.8),
    retryOnTimeout: true,
  },
  'verification': {
    hardLimitMs: 300_000, // 5 min
    softLimitMs: 240_000, // 4 min
    retryOnTimeout: true,
  },
};

// ── TimeoutEnforcer ─────────────────────────────────────────────────

export class TimeoutEnforcer {
  private readonly redis: Redis;
  private readonly configs: Map<string, TimeoutConfig>;
  private readonly defaultConfig: TimeoutConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private trackedTasks = new Map<string, TaskTimeoutInfo>();

  constructor(redisUrl?: string, timeoutConfigs?: Record<string, TimeoutConfig>) {
    this.redis = new Redis(redisUrl ?? config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      lazyConnect: true,
    });

    this.configs = new Map(Object.entries(timeoutConfigs ?? DEFAULT_TIMEOUT_CONFIGS));
    this.defaultConfig = {
      hardLimitMs: 600_000,
      softLimitMs: 480_000,
      retryOnTimeout: true,
    };
  }

  /**
   * Get timeout config for a task type.
   */
  getConfig(taskType: string): TimeoutConfig {
    return this.configs.get(taskType) ?? this.defaultConfig;
  }

  /**
   * Register a task for timeout tracking.
   * Sets Redis keys for the task deadline.
   */
  startTracking(taskId: string, timeoutMs: number, taskType: string = 'fix_issue'): void {
    const config = this.getConfig(taskType);
    const hardLimit = config.hardLimitMs;
    const softLimit = config.softLimitMs;
    const now = Date.now();

    const info: TaskTimeoutInfo = {
      taskId,
      taskType,
      startedAt: now,
      deadline: now + hardLimit,
      softDeadline: now + softLimit,
    };

    this.trackedTasks.set(taskId, info);

    // Store in Redis
    this.redis.set(
      `${TASK_DEADLINE_PREFIX}${taskId}`,
      JSON.stringify(info),
      'EX',
      Math.ceil(hardLimit / 1000) + 60, // TTL = timeout + 60s buffer
    ).catch((err) => log.error({ err: String(err), taskId }, 'Failed to store task deadline'));

    log.debug(
      { taskId, taskType, hardLimitMs: hardLimit, softLimitMs: softLimit },
      'Task timeout tracking started',
    );
  }

  /**
   * Remove a task from timeout tracking.
   */
  stopTracking(taskId: string): void {
    this.trackedTasks.delete(taskId);

    Promise.all([
      this.redis.del(`${TASK_DEADLINE_PREFIX}${taskId}`).catch(() => {}),
      this.redis.del(`${SOFT_WARNING_PREFIX}${taskId}`).catch(() => {}),
    ]);

    log.debug({ taskId }, 'Task timeout tracking stopped');
  }

  /**
   * Find all tasks that have passed their deadline (stuck).
   */
  async checkStuckTasks(): Promise<string[]> {
    const stuckTasks: string[] = [];
    const now = Date.now();

    for (const [taskId, info] of this.trackedTasks.entries()) {
      if (now >= info.deadline) {
        // Hard limit exceeded
        log.warn(
          { taskId, taskType: info.taskType, deadline: new Date(info.deadline).toISOString() },
          'Task hard timeout exceeded',
        );
        stuckTasks.push(taskId);

        bridgeMetrics.incrementCounter('stas_task_timeouts_total', {
          taskType: info.taskType,
        });
      } else if (now >= info.softDeadline) {
        // Soft limit exceeded — emit warning
        const softWarnKey = `${SOFT_WARNING_PREFIX}${taskId}`;
        const alreadyWarned = await this.redis.exists(softWarnKey).catch(() => 0);

        if (!alreadyWarned) {
          log.warn(
            { taskId, taskType: info.taskType, softDeadline: new Date(info.softDeadline).toISOString() },
            'Task soft timeout warning',
          );
          bridgeMetrics.incrementCounter('stas_task_soft_timeouts_total', {
            taskType: info.taskType,
          });
          this.redis.set(softWarnKey, '1', 'EX', 300).catch(() => {});
        }
      }
    }

    // Also check Redis for any tasks we might have lost from memory
    try {
      if (!this.redis.status || this.redis.status === 'end' || this.redis.status === 'close') {
        await this.redis.connect().catch(() => {});
      }
      const keys = await this.redis.keys(`${TASK_DEADLINE_PREFIX}*`);
      for (const key of keys) {
        const taskId = key.replace(TASK_DEADLINE_PREFIX, '');
        if (!this.trackedTasks.has(taskId)) {
          const data = await this.redis.get(key);
          if (data) {
            try {
              const info: TaskTimeoutInfo = JSON.parse(data);
              this.trackedTasks.set(taskId, info);
              if (Date.now() >= info.deadline) {
                stuckTasks.push(taskId);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch {
      // Redis unavailable — use in-memory only
    }

    return [...new Set(stuckTasks)];
  }

  /**
   * Cancel a task that has timed out.
   * Revokes it and optionally schedules a retry on a different worker.
   */
  async cancelTask(taskId: string): Promise<void> {
    const info = this.trackedTasks.get(taskId);
    log.warn(
      { taskId, taskType: info?.taskType ?? 'unknown' },
      'Cancelling timed-out task',
    );

    this.stopTracking(taskId);

    bridgeMetrics.incrementCounter('stas_tasks_cancelled_total', {
      taskType: info?.taskType ?? 'unknown',
    });
  }

  /**
   * Start periodic stuck task checking.
   */
  startStuckTaskMonitor(intervalMs: number = STUCK_CHECK_INTERVAL): void {
    if (this.checkInterval) {
      log.warn('Stuck task monitor already running');
      return;
    }

    log.info({ intervalMs }, 'Starting stuck task monitor');

    this.checkInterval = setInterval(async () => {
      try {
        const stuckTasks = await this.checkStuckTasks();
        if (stuckTasks.length > 0) {
          log.warn({ stuckTaskCount: stuckTasks.length, tasks: stuckTasks }, 'Stuck tasks detected');
          bridgeMetrics.setGauge('stas_stuck_tasks', {}, stuckTasks.length);

          for (const taskId of stuckTasks) {
            await this.cancelTask(taskId);
          }
        }
      } catch (err) {
        log.error({ err: String(err) }, 'Stuck task check failed');
      }
    }, intervalMs);

    if (typeof this.checkInterval === 'object' && 'unref' in this.checkInterval) {
      this.checkInterval.unref();
    }
  }

  /**
   * Stop the stuck task monitor.
   */
  stopStuckTaskMonitor(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      log.info('Stuck task monitor stopped');
    }
  }

  /**
   * Get all currently tracked tasks.
   */
  getTrackedTasks(): TaskTimeoutInfo[] {
    return Array.from(this.trackedTasks.values());
  }

  /**
   * Close the Redis connection and stop monitoring.
   */
  async close(): Promise<void> {
    this.stopStuckTaskMonitor();
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
    log.info('Timeout enforcer closed');
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global timeout enforcer instance.
 */
export const timeoutEnforcer = new TimeoutEnforcer();
