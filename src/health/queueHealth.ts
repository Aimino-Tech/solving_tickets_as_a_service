/**
 * Queue Health — monitoring for BullMQ and RabbitMQ queue health.
 *
 * Provides:
 *   - Queue depth checks (BullMQ via Redis, RabbitMQ via Management API)
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

import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import * as rabbitmq from '../queue/rabbitmq.js';
import { bridgeMetrics, recordConsumerLag } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'queue-health' });

// ── Constants ───────────────────────────────────────────────────────

const QUEUE_NAME = 'stas-issues';
const DLQ_NAME = 'stas-issues-dlq';

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
  rabbitmq: {
    connected: boolean;
    pendingMessages: number;
    consumers: number;
  };
}

export interface QueueHealthEntry {
  name: string;
  type: 'main' | 'dlq';
  depth: number;
  status: 'ok' | 'warn' | 'critical';
  consumers?: number;
}

// ── Redis-based queue depth (for BullMQ queues) ────────────────────

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, 'Redis health connection retry in ${delay}ms');
        return delay;
      },
      lazyConnect: true,
    });
  }
  return redis;
}

async function getBullMQQueueDepth(queueName: string): Promise<number> {
  try {
    const r = getRedis();
    if (!r.status || r.status === 'end' || r.status === 'close') {
      await r.connect().catch(() => {});
    }

    const [wait, active, delayed, paused] = await Promise.all([
      r.llen('bull:' + queueName + ':wait').catch(() => 0),
      r.llen('bull:' + queueName + ':active').catch(() => 0),
      r.zcount('bull:' + queueName + ':delayed', '-inf', '+inf').catch(() => 0),
      r.llen('bull:' + queueName + ':paused').catch(() => 0),
    ]);

    return (wait ?? 0) + (active ?? 0) + (delayed ?? 0) + (paused ?? 0);
  } catch (err) {
    log.warn({ err: String(err), queueName }, 'Failed to get BullMQ queue depth');
    return -1;
  }
}

async function getBullMQFailedCount(queueName: string): Promise<number> {
  try {
    const r = getRedis();
    if (!r.status || r.status === 'end' || r.status === 'close') {
      await r.connect().catch(() => {});
    }
    return (await r.zcount('bull:' + queueName + ':failed', '-inf', '+inf').catch(() => 0)) ?? 0;
  } catch {
    return -1;
  }
}

// ── RabbitMQ Management API client ──────────────────────────────────

interface RabbitMQQueueInfo {
  name: string;
  messages: number;
  messages_ready: number;
  messages_unacknowledged: number;
  consumers: number;
}

async function fetchRabbitMQQueues(): Promise<RabbitMQQueueInfo[]> {
  const url = config.rabbitmq.url;
  if (!url || rabbitmq.isConnected() === false) {
    return [];
  }

  try {
    const parsed = new URL(url);
    const mgmtBase = 'http://' + parsed.hostname + ':15672';
    const vhost = (parsed.pathname || '/').replace(/^\//, '');
    const username = parsed.username || 'guest';
    const password = parsed.password || 'guest';
    const auth = Buffer.from(username + ':' + password).toString('base64');

    const response = await fetch(
      mgmtBase + '/api/queues/' + encodeURIComponent(vhost),
      {
        headers: {
          Authorization: 'Basic ' + auth,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      log.warn({ status: response.status }, 'RabbitMQ Management API returned error');
      return [];
    }

    return (await response.json()) as RabbitMQQueueInfo[];
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to fetch RabbitMQ queue info');
    return [];
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

  const [mainDepth, dlqDepth, failedCount] = await Promise.all([
    getBullMQQueueDepth(QUEUE_NAME),
    getBullMQQueueDepth(DLQ_NAME),
    getBullMQFailedCount(QUEUE_NAME),
  ]);

  const rabbitQueues = await fetchRabbitMQQueues();

  const queueEntries: QueueHealthEntry[] = [];
  let totalMessages = 0;
  let dlqMessages = 0;
  let queuesWithWarnings = 0;
  let queuesWithCritical = 0;

  // BullMQ queues
  const bullQueues = [
    { name: QUEUE_NAME, type: 'main' as const, depth: mainDepth },
    { name: DLQ_NAME, type: 'dlq' as const, depth: dlqDepth },
  ];

  for (const q of bullQueues) {
    const s = queueStatus(q.depth, q.type === 'dlq');
    queueEntries.push({ name: q.name, type: q.type, depth: Math.max(0, q.depth), status: s });
    totalMessages += Math.max(0, q.depth);
    if (q.type === 'dlq') dlqMessages += Math.max(0, q.depth);
    if (s === 'warn') queuesWithWarnings++;
    if (s === 'critical') queuesWithCritical++;
  }

  // RabbitMQ queues
  let rabbitPending = 0;
  let rabbitConsumers = 0;
  for (const q of rabbitQueues) {
    const isDlq = q.name.endsWith('.dlq');
    const s = queueStatus(q.messages, isDlq);
    queueEntries.push({ name: q.name, type: isDlq ? 'dlq' : 'main', depth: q.messages, status: s, consumers: q.consumers });
    totalMessages += q.messages;
    if (isDlq) dlqMessages += q.messages;
    if (s === 'warn') queuesWithWarnings++;
    if (s === 'critical') queuesWithCritical++;
    rabbitPending += q.messages_ready ?? 0;
    rabbitConsumers += q.consumers ?? 0;
    recordConsumerLag(q.name, q.messages_ready ?? 0);
  }

  // Prometheus gauges
  bridgeMetrics.setGauge('queue_depth', { queue: QUEUE_NAME, type: 'bullmq' }, Math.max(0, mainDepth));
  bridgeMetrics.setGauge('queue_depth', { queue: DLQ_NAME, type: 'bullmq' }, Math.max(0, dlqDepth));
  bridgeMetrics.setGauge('queue_depth', { queue: 'failed', type: 'bullmq' }, Math.max(0, failedCount));

  let overallStatus: QueueHealthReport['status'] = 'healthy';
  if (queuesWithCritical > 0) overallStatus = 'critical';
  else if (queuesWithWarnings > 0) overallStatus = 'degraded';

  return {
    status: overallStatus,
    timestamp,
    summary: {
      totalMessages,
      dlqMessages,
      activeWorkers: rabbitConsumers,
      queuesWithWarnings,
      queuesWithCritical,
    },
    queues: queueEntries,
    rabbitmq: {
      connected: rabbitmq.isConnected(),
      pendingMessages: rabbitPending,
      consumers: rabbitConsumers,
    },
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

export async function closeHealthRedis(): Promise<void> {
  if (redis) {
    try { await redis.quit(); } catch { /* non-fatal */ }
    redis = null;
  }
}
