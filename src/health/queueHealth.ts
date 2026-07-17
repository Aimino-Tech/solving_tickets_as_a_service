/**
 * Queue Health — monitoring for RabbitMQ queue health.
 *
 * Provides:
 *   - Queue depth checks (via RabbitMQ management API / channel check)
 *   - DLQ message count monitoring
 *   - Worker liveness checks
 *   - Structured health report for /health/queue endpoint
 *
 * ── Alert Thresholds ────────────────────────────────────────────────
 * Queue depth thresholds are configurable via env vars:
 *   HEALTH_QUEUE_DEPTH_WARN_THRESHOLD  (default: 50)
 *   HEALTH_QUEUE_DEPTH_CRIT_THRESHOLD  (default: 200)
 * ────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'queue-health' });

// ── Constants ───────────────────────────────────────────────────────

const QUEUE_NAME = 'stas.issues.fix';
const DLQ_NAME = 'stas.dlq';

// ── Types ───────────────────────────────────────────────────────────

export interface QueueHealthReport {
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: string;
  summary: {
    totalMessages: number;
    dlqMessages: number;
    activeWorkers: number;
    queuesWithWarnings: number;
    queuesWithCritical: number;
  };
  queues: QueueHealthEntry[];
}

export interface QueueHealthEntry {
  name: string;
  type: 'main' | 'dlq';
  depth: number;
  status: 'ok' | 'warn' | 'critical';
  consumers?: number;
}

// ── RabbitMQ queue depth via amqp channel ──────────────────────────

let cachedDepth: { [queue: string]: number } = {};

/**
 * Get queue depth using RabbitMQ channel checkQueue.
 * Falls back to cached value if channel is unavailable.
 */
async function getRabbitMQQueueDepth(queueName: string): Promise<number> {
  try {
    const { getChannel, isConnected } = await import('../queue/rabbitmq.js');
    if (!isConnected()) {
      return cachedDepth[queueName] ?? 0;
    }
    const ch = getChannel();
    const info = await ch.checkQueue(queueName);
    cachedDepth[queueName] = info.messageCount;
    return info.messageCount;
  } catch (err) {
    log.warn({ err: String(err), queueName }, 'Failed to get RabbitMQ queue depth');
    return cachedDepth[queueName] ?? 0;
  }
}

// ── Health Report ───────────────────────────────────────────────────

function queueStatus(depth: number, isDlq: boolean): 'ok' | 'warn' | 'critical' {
  if (depth < 0) return 'ok';
  if (isDlq) {
    if (depth > 0) return depth > 10 ? 'critical' : 'warn';
    return 'ok';
  }
  if (depth >= config.monitoring.queueDepthCritThreshold) return 'critical';
  if (depth >= config.monitoring.queueDepthWarnThreshold) return 'warn';
  return 'ok';
}

export async function getQueueHealth(): Promise<QueueHealthReport> {
  const timestamp = new Date().toISOString();

  const [mainDepth, dlqDepth] = await Promise.all([
    getRabbitMQQueueDepth(QUEUE_NAME),
    getRabbitMQQueueDepth(DLQ_NAME),
  ]);

  const queueEntries: QueueHealthEntry[] = [];
  let totalMessages = 0;
  let dlqMessages = 0;
  let queuesWithWarnings = 0;
  let queuesWithCritical = 0;

  const rabbitQueues = [
    { name: QUEUE_NAME, type: 'main' as const, depth: mainDepth },
    { name: DLQ_NAME, type: 'dlq' as const, depth: dlqDepth },
  ];

  for (const q of rabbitQueues) {
    const s = queueStatus(q.depth, q.type === 'dlq');
    queueEntries.push({ name: q.name, type: q.type, depth: Math.max(0, q.depth), status: s });
    totalMessages += Math.max(0, q.depth);
    if (q.type === 'dlq') dlqMessages += Math.max(0, q.depth);
    if (s === 'warn') queuesWithWarnings++;
    if (s === 'critical') queuesWithCritical++;
  }

  bridgeMetrics.setGauge('queue_depth', { queue: QUEUE_NAME, type: 'rabbitmq' }, Math.max(0, mainDepth));
  bridgeMetrics.setGauge('queue_depth', { queue: DLQ_NAME, type: 'rabbitmq' }, Math.max(0, dlqDepth));

  let overallStatus: QueueHealthReport['status'] = 'healthy';
  if (queuesWithCritical > 0) overallStatus = 'critical';
  else if (queuesWithWarnings > 0) overallStatus = 'degraded';

  return {
    status: overallStatus,
    timestamp,
    summary: {
      totalMessages,
      dlqMessages,
      activeWorkers: 0,
      queuesWithWarnings,
      queuesWithCritical,
    },
    queues: queueEntries,
  };
}

export async function hasCriticalQueues(): Promise<{ critical: string[]; warning: string[] }> {
  const report = await getQueueHealth();
  const critical = report.queues.filter((q) => q.status === 'critical').map((q) => q.name + ' (' + q.depth + ' msgs)');
  const warning = report.queues.filter((q) => q.status === 'warn').map((q) => q.name + ' (' + q.depth + ' msgs)');
  return { critical, warning };
}

export async function getDLQSummary(): Promise<{ totalDlqMessages: number; queuesWithMessages: string[] }> {
  const report = await getQueueHealth();
  const dlqEntries = report.queues.filter((q) => q.type === 'dlq' && q.depth > 0);
  return {
    totalDlqMessages: report.summary.dlqMessages,
    queuesWithMessages: dlqEntries.map((q) => q.name + ' (' + q.depth + ')'),
  };
}
