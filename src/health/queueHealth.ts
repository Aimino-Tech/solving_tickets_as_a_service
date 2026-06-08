/**
 * Queue Health — monitoring for RabbitMQ queue health.
 *
 * Provides:
 *   - Queue depth checks (RabbitMQ via Management API)
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
import * as rabbitmq from '../queue/rabbitmq.js';
import { bridgeMetrics, recordConsumerLag } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'queue-health' });

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

  const rabbitQueues = await fetchRabbitMQQueues();

  const queueEntries: QueueHealthEntry[] = [];
  let totalMessages = 0;
  let dlqMessages = 0;
  let queuesWithWarnings = 0;
  let queuesWithCritical = 0;

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

  // Prometheus gauges — RabbitMQ only
  bridgeMetrics.setGauge('queue_depth', { type: 'rabbitmq' }, Math.max(0, totalMessages));

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

/**
 * Close the health Redis connection (no-op after BullMQ removal).
 * Kept for backward compatibility.
 */
export async function closeHealthRedis(): Promise<void> {
  // No-op — BullMQ Redis connection no longer maintained by queue health
}

export async function getDLQSummary(): Promise<{ totalDlqMessages: number; queuesWithMessages: string[] }> {
  const report = await getQueueHealth();
  const dlqEntries = report.queues.filter((q) => q.type === 'dlq' && q.depth > 0);
  return {
    totalDlqMessages: report.summary.dlqMessages,
    queuesWithMessages: dlqEntries.map((q) => q.name + ' (' + q.depth + ')'),
  };
}
