// @ts-nocheck
/**
 * Queue Drain Monitor - checks queue depth and alerts when queues back up.
 *
 * If any queue depth exceeds 100 messages and there are no active workers
 * consuming from that queue, the monitor alerts via the alerting system.
 *
 * This is the TypeScript counterpart to workers/orchestrator/queue_drain.py.
 *
 * Configuration (env vars):
 *   QUEUE_DRAIN_WARN_DEPTH  (default: 100)
 *   QUEUE_DRAIN_CRIT_DEPTH  (default: 500)
 *   QUEUE_DRAIN_CHECK_INTERVAL_MS (default: 60000)
 *   QUEUE_DRAIN_AUTO_SCALE  (default: false)
 *   QUEUE_DRAIN_SCALE_UP_URL
 *
 * The monitor is started via startQueueDrainMonitor() and runs in a
 * background interval loop.
 */

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { getQueueHealth } from '../health/queueHealth.js';
import { checkQueueDepth } from '../monitoring/alerting.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'queue-monitor' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARN_DEPTH = Number(process.env.QUEUE_DRAIN_WARN_DEPTH) || 100;
const CRIT_DEPTH = Number(process.env.QUEUE_DRAIN_CRIT_DEPTH) || 500;
const CHECK_INTERVAL_MS = Number(process.env.QUEUE_DRAIN_CHECK_INTERVAL_MS) || 60_000;
const AUTO_SCALE = (process.env.QUEUE_DRAIN_AUTO_SCALE || 'false').toLowerCase() === 'true';
const SCALE_UP_URL = process.env.QUEUE_DRAIN_SCALE_UP_URL || '';

// ---------------------------------------------------------------------------
// BullMQ queue names to monitor
// ---------------------------------------------------------------------------

const BULLMQ_QUEUES = ['stas-issues', 'stas-issues-dlq'];

// ---------------------------------------------------------------------------
// Redis client (lazy singleton)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Redis connection retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });
    _redis.on('error', (err) => {
      log.error({ err: String(err) }, 'Queue monitor Redis error');
    });
  }
  return _redis;
}

// ---------------------------------------------------------------------------
// Queue Depth via Redis (BullMQ)
// ---------------------------------------------------------------------------

async function getBullMQDepth(queueName: string): Promise<number> {
  const redis = getRedis();

  try {
    const prefix = `bull:${queueName}:`;
    const [wait, active, delayed, paused] = await Promise.all([
      redis.llen(`${prefix}wait`).catch(() => 0),
      redis.llen(`${prefix}active`).catch(() => 0),
      redis.zcount(`${prefix}delayed`, '-inf', '+inf').catch(() => 0),
      redis.llen(`${prefix}paused`).catch(() => 0),
    ]);
    return (wait ?? 0) + (active ?? 0) + (delayed ?? 0) + (paused ?? 0);
  } catch (err) {
    log.warn({ err: String(err), queueName }, 'Failed to get BullMQ queue depth');
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Worker Detection
// ---------------------------------------------------------------------------

async function getActiveWorkerCount(): Promise<number> {
  try {
    const health = await getQueueHealth();
    return health.summary.activeWorkers;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

async function triggerScaleUp(queueName: string, depth: number): Promise<boolean> {
  if (!AUTO_SCALE || !SCALE_UP_URL) {
    log.info(
      { queueName, depth },
      'Auto-scale skipped - not configured (set QUEUE_DRAIN_AUTO_SCALE=true and QUEUE_DRAIN_SCALE_UP_URL)',
    );
    return false;
  }

  try {
    const response = await fetch(SCALE_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queue: queueName,
        depth,
        scaleBy: 1,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Scale-up HTTP ${response.status}: ${await response.text().catch(() => 'unknown')}`);
    }

    log.warn({ queueName, depth }, 'Auto-scale triggered');
    bridgeMetrics.incrementCounter('auto_scale_triggered', { queue: queueName });
    return true;
  } catch (err) {
    log.error({ err: String(err), queueName }, 'Auto-scale failed');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Check
// ---------------------------------------------------------------------------

export interface QueueDrainResult {
  checkedAt: string;
  queues: Array<{
    name: string;
    depth: number;
    drainStatus: 'ok' | 'warning' | 'critical';
    hasWorkers: boolean;
  }>;
  alerts: Array<{ queue: string; severity: 'warning' | 'critical'; message: string }>;
  scaleUps: number;
}

export async function checkQueueDrain(): Promise<QueueDrainResult> {
  const result: QueueDrainResult = {
    checkedAt: new Date().toISOString(),
    queues: [],
    alerts: [],
    scaleUps: 0,
  };

  const activeWorkers = await getActiveWorkerCount();

  for (const queueName of BULLMQ_QUEUES) {
    const depth = await getBullMQDepth(queueName);
    if (depth < 0) continue;

    const hasWorkers = activeWorkers > 0;

    const entry = {
      name: queueName,
      depth,
      drainStatus: 'ok' as const,
      hasWorkers,
    };

    // Warning: depth > threshold and no workers
    if (depth > WARN_DEPTH && !hasWorkers) {
      entry.drainStatus = 'warning';
      const message = `Queue '${queueName}' depth=${depth} exceeds warn threshold=${WARN_DEPTH} with no active workers`;
      log.warn({ queueName, depth, activeWorkers }, message);
      result.alerts.push({ queue: queueName, severity: 'warning', message });

      checkQueueDepth(depth, 5);

      if (AUTO_SCALE && SCALE_UP_URL) {
        const scaled = await triggerScaleUp(queueName, depth);
        if (scaled) result.scaleUps++;
      }
    }

    // Critical: depth > critical threshold (regardless of workers)
    if (depth > CRIT_DEPTH) {
      entry.drainStatus = 'critical';
      const message = `Queue '${queueName}' depth=${depth} exceeds critical threshold=${CRIT_DEPTH}`;
      log.error({ queueName, depth, activeWorkers }, message);
      result.alerts.push({ queue: queueName, severity: 'critical', message });
    }

    result.queues.push(entry);

    bridgeMetrics.setGauge('queue_depth', { queue: queueName, type: 'bullmq' }, depth);
  }

  bridgeMetrics.setGauge('queue_drain_alerts', {}, result.alerts.length);

  return result;
}

// ---------------------------------------------------------------------------
// Background Monitor
// ---------------------------------------------------------------------------

let monitorTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the queue drain background monitor.
 * Call once during application startup.
 */
export function startQueueDrainMonitor(): void {
  if (monitorTimer) {
    log.warn('Queue drain monitor already running');
    return;
  }

  log.info(
    { checkIntervalMs: CHECK_INTERVAL_MS, warnDepth: WARN_DEPTH, critDepth: CRIT_DEPTH, autoScale: AUTO_SCALE },
    'Starting queue drain monitor',
  );

  monitorTimer = setInterval(async () => {
    try {
      await checkQueueDrain();
    } catch (err) {
      log.error({ err: String(err) }, 'Queue drain monitor check failed');
    }
  }, CHECK_INTERVAL_MS);

  // Run initial check immediately
  checkQueueDrain().catch((err) => log.error({ err: String(err) }, 'Initial queue drain check failed'));
}

/**
 * Stop the queue drain background monitor.
 */
export function stopQueueDrainMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    log.info('Queue drain monitor stopped');
  }
}
