/**
 * Queue Drain Monitor — monitors queue depth and detects stuck queues.
 *
 * Features:
 *   - Check RabbitMQ queue depth
 *   - Detect stuck queues (depth > threshold AND no active workers)
 *   - Alert when no workers are consuming
 *   - Auto-scale hint for KEDA
 *
 * Usage:
 *   const monitor = new QueueDrainMonitor();
 *   const depth = await monitor.checkQueueDepth('stas-issues');
 *   const stuck = await monitor.isQueueStuck('stas-issues', 100);
 */

import { connect as amqpConnect } from 'amqplib';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import { workerHeartbeatMonitor } from '../monitoring/heartbeat.js';
import { dispatchAlert } from '../monitoring/alerting.js';

const log = rootLogger.child({ module: 'queue-drain-monitor' });

// ── Constants ───────────────────────────────────────────────────────

const DRAIN_MONITOR_INTERVAL = 30_000; // Check every 30s
const DEFAULT_STUCK_THRESHOLD = 100;

// ── Types ───────────────────────────────────────────────────────────

export interface QueueDepthInfo {
  queueName: string;
  depth: number;
  consumers: number;
  workers: number;
  stuck: boolean;
}

export interface DrainAlert {
  queueName: string;
  depth: number;
  threshold: number;
  timestamp: string;
  message: string;
}

// ── QueueDrainMonitor ───────────────────────────────────────────────

export class QueueDrainMonitor {
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private readonly alertHistory = new Map<string, number>(); // queueName -> last alert time
  private readonly alertCooldownMs = 300_000; // 5 minutes between alerts

  /**
   * Check RabbitMQ queue depth.
   * Uses the RabbitMQ Management HTTP API if available, otherwise falls back
   * to AMQP protocol checks.
   */
  async checkQueueDepth(queueName: string): Promise<number> {
    try {
      // Try RabbitMQ Management API first
      const mgmtUrl = process.env.RABBITMQ_MANAGEMENT_URL;
      if (mgmtUrl) {
        const username = process.env.RABBITMQ_MANAGEMENT_USERNAME ?? 'guest';
        const password = process.env.RABBITMQ_MANAGEMENT_PASSWORD ?? 'guest';
        const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

        const response = await fetch(
          `${mgmtUrl}/api/queues/%2F/${encodeURIComponent(queueName)}`,
          {
            headers: {
              Authorization: `Basic ${basicAuth}`,
            },
          },
        );

        if (response.ok) {
          const data = await response.json() as { messages_ready?: number; messages_unacknowledged?: number };
          const depth = (data.messages_ready ?? 0) + (data.messages_unacknowledged ?? 0);
          bridgeMetrics.setGauge('stas_queue_depth', { queue: queueName }, depth);
          return depth;
        }
      }

      // Fallback: use AMQP to check queue
      const connection = await amqpConnect(config.queue.rabbitmqUrl);
      try {
        const channel = await connection.createChannel();
        const queueInfo = await channel.checkQueue(queueName);
        const depth = queueInfo.messageCount;
        bridgeMetrics.setGauge('stas_queue_depth', { queue: queueName }, depth);
        return depth;
      } finally {
        await connection.close().catch(() => {});
      }
    } catch (err) {
      log.warn({ err: String(err), queueName }, 'Failed to check queue depth');
      return -1;
    }
  }

  /**
   * Check if a queue is stuck (depth > threshold AND no active workers).
   */
  async isQueueStuck(queueName: string, threshold: number = DEFAULT_STUCK_THRESHOLD): Promise<boolean> {
    try {
      const depth = await this.checkQueueDepth(queueName);
      if (depth < 0) {
        return false; // Can't determine
      }

      if (depth <= threshold) {
        return false; // Queue depth is acceptable
      }

      // Check if there are any live workers
      const liveWorkers = await workerHeartbeatMonitor.getLiveWorkers();
      if (liveWorkers.length > 0) {
        return false; // Workers are alive, queue will drain
      }

      // Queue is deep AND no workers — stuck!
      log.warn(
        { queueName, depth, threshold, liveWorkers: liveWorkers.length },
        'Queue is stuck — depth exceeds threshold with no active workers',
      );

      return true;
    } catch (err) {
      log.error({ err: String(err), queueName }, 'Failed to check if queue is stuck');
      return false;
    }
  }

  /**
   * Alert when there are no workers consuming a queue.
   */
  async alertNoWorkers(queueName: string, depth: number): Promise<void> {
    // Check cooldown
    const lastAlert = this.alertHistory.get(queueName) ?? 0;
    if (Date.now() - lastAlert < this.alertCooldownMs) {
      return; // Still in cooldown
    }

    this.alertHistory.set(queueName, Date.now());

    const message = `Queue "${queueName}" has depth ${depth} but no active workers consuming it`;

    log.error({ queueName, depth }, message);

    // Fire Prometheus metric
    bridgeMetrics.incrementCounter('stas_queue_drain_alerts_total', { queue: queueName });

    // Dispatch alert
    await dispatchAlert({
      severity: 'critical',
      rule: 'queue_stuck_no_workers',
      message,
      context: { queueName, depth },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Provide an auto-scale hint for KEDA.
   * If KEDA is configured, this could trigger scaling events.
   */
  autoScaleHint(depth: number): void {
    if (!process.env.KEDA_ENABLED || process.env.KEDA_ENABLED !== 'true') {
      return; // KEDA not configured
    }

    const kedaScaledObject = process.env.KEDA_SCALED_OBJECT ?? 'stas-worker';

    log.info(
      { depth, kedaScaledObject },
      'Auto-scale hint: depth=%d for scaledObject=%s',
      depth,
      kedaScaledObject,
    );

    // In production, this would call the KEDA API or set a metric that
    // KEDA's ScaledObject is watching.
    bridgeMetrics.setGauge('stas_keda_scale_hint', { scaledObject: kedaScaledObject }, depth);
  }

  /**
   * Get comprehensive queue depth info for all monitored queues.
   */
  async getQueueDepthInfo(): Promise<QueueDepthInfo[]> {
    const queueNames = [
      'stas.agents.dispatch',
      'stas.agents.verification',
      'stas.agents.sandbox',
      'stas.agents.self_audit',
      'stas.issues.triage',
      'stas.issues.health',
      'stas.queue.pr',
      'stas.queue.notifications',
      'stas-issues',
    ];

    const liveWorkers = await workerHeartbeatMonitor.getLiveWorkers();
    const results: QueueDepthInfo[] = [];

    for (const queueName of queueNames) {
      try {
        const depth = await this.checkQueueDepth(queueName);
        results.push({
          queueName,
          depth: Math.max(0, depth),
          consumers: 0,
          workers: liveWorkers.length,
          stuck: depth > DEFAULT_STUCK_THRESHOLD && liveWorkers.length === 0,
        });
      } catch {
        results.push({
          queueName,
          depth: -1,
          consumers: 0,
          workers: liveWorkers.length,
          stuck: false,
        });
      }
    }

    return results;
  }

  /**
   * Start the periodic queue drain monitor.
   */
  startMonitor(intervalMs: number = DRAIN_MONITOR_INTERVAL): void {
    if (this.monitorInterval) {
      log.warn('Queue drain monitor already running');
      return;
    }

    log.info({ intervalMs }, 'Starting queue drain monitor');

    this.monitorInterval = setInterval(async () => {
      try {
        const queueNames = [
          'stas.agents.dispatch',
          'stas.agents.verification',
          'stas.agents.sandbox',
          'stas.agents.self_audit',
          'stas.issues.triage',
          'stas.issues.health',
          'stas.queue.pr',
          'stas.queue.notifications',
          'stas-issues',
        ];

        for (const queueName of queueNames) {
          const depth = await this.checkQueueDepth(queueName);
          if (depth < 0) continue;

          const stuck = await this.isQueueStuck(queueName);
          if (stuck) {
            await this.alertNoWorkers(queueName, depth);
            this.autoScaleHint(depth);
          }
        }
      } catch (err) {
        log.error({ err: String(err) }, 'Queue drain monitor check failed');
      }
    }, intervalMs);

    if (typeof this.monitorInterval === 'object' && 'unref' in this.monitorInterval) {
      this.monitorInterval.unref();
    }
  }

  /**
   * Stop the queue drain monitor.
   */
  stopMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      log.info('Queue drain monitor stopped');
    }
  }

  /**
   * Close all connections.
   */
  async close(): Promise<void> {
    this.stopMonitor();
    log.info('Queue drain monitor closed');
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global queue drain monitor instance.
 */
export const queueDrainMonitor = new QueueDrainMonitor();
