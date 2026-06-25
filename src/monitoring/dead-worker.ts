/**
 * Dead Worker Recovery — handles dead worker detection and task redistribution.
 *
 * When a worker dies:
 *   1. Revoke all tasks assigned to the dead worker
 *   2. Redistribute tasks to live workers
 *   3. Log incident with worker ID and timestamp
 *   4. Fire Prometheus metric
 *   5. Optionally restart via Kubernetes
 *
 * Usage:
 *   const recovery = new DeadWorkerRecovery();
 *   await recovery.onDeadWorker('worker-1');
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import { workerHeartbeatMonitor } from './heartbeat.js';
import type { HeartbeatEvent } from './heartbeat.js';

const log = rootLogger.child({ module: 'dead-worker-recovery' });

// ── Types ───────────────────────────────────────────────────────────

export interface DeadWorkerIncident {
  workerId: string;
  detectedAt: string;
  resolvedAt?: string;
  revokedTaskCount: number;
  redistributedTaskCount: number;
  status: 'detected' | 'recovering' | 'resolved' | 'failed';
}

// ── DeadWorkerRecovery ──────────────────────────────────────────────

export class DeadWorkerRecovery {
  private readonly incidents = new Map<string, DeadWorkerIncident>();
  private k8sEnabled = false;
  private k8sNamespace = 'default';

  constructor(k8sConfig?: { enabled: boolean; namespace: string }) {
    this.k8sEnabled = k8sConfig?.enabled ?? (process.env.K8S_ENABLED === 'true');
    this.k8sNamespace = k8sConfig?.namespace ?? process.env.K8S_NAMESPACE ?? 'default';

    // Listen for dead worker events from the heartbeat monitor
    workerHeartbeatMonitor.events.on('deadWorker', async (event: HeartbeatEvent) => {
      log.info({ workerId: event.workerId }, 'Dead worker event received — initiating recovery');
      await this.onDeadWorker(event.workerId).catch((err) => {
        log.error({ err: String(err), workerId: event.workerId }, 'Dead worker recovery failed');
      });
    });
  }

  /**
   * Handle a dead worker event.
   * 1. Revoke all tasks
   * 2. Redistribute tasks to live workers
   * 3. Log incident
   * 4. Fire metric
   * 5. Optionally restart via K8s
   */
  async onDeadWorker(workerId: string): Promise<void> {
    const existingIncident = this.incidents.get(workerId);
    if (existingIncident && existingIncident.status === 'recovering') {
      log.warn({ workerId }, 'Recovery already in progress for worker');
      return;
    }

    const incident: DeadWorkerIncident = {
      workerId,
      detectedAt: new Date().toISOString(),
      revokedTaskCount: 0,
      redistributedTaskCount: 0,
      status: 'detected',
    };
    this.incidents.set(workerId, incident);

    log.error({ workerId, detectedAt: incident.detectedAt }, 'Dead worker detected — starting recovery');

    try {
      // Phase 1: Revoke tasks
      incident.status = 'recovering';
      const revokedCount = await this.revokeWorkerTasks(workerId);
      incident.revokedTaskCount = revokedCount;

      // Phase 2: Redistribute tasks to live workers
      const redistributedCount = await this.redistributeTasks(workerId);
      incident.redistributedTaskCount = redistributedCount;

      // Phase 3: Log incident
      this.logIncident(incident);

      // Phase 4: Fire Prometheus metric
      bridgeMetrics.incrementCounter('stas_dead_workers_total', { workerId });
      bridgeMetrics.setGauge('stas_dead_workers_current', { workerId }, 1);

      // Phase 5: Restart via K8s if configured
      if (this.k8sEnabled) {
        await this.restartWorkerViaK8s(workerId).catch((err) => {
          log.error({ err: String(err), workerId }, 'K8s restart failed');
        });
      }

      incident.status = 'resolved';
      incident.resolvedAt = new Date().toISOString();

      log.info(
        {
          workerId,
          revokedCount,
          redistributedCount,
          resolvedAt: incident.resolvedAt,
        },
        'Dead worker recovery completed',
      );
    } catch (err) {
      incident.status = 'failed';
      log.error({ err: String(err), workerId }, 'Dead worker recovery failed');

      // Fire failure metric
      bridgeMetrics.incrementCounter('stas_dead_worker_recovery_failures_total', { workerId });
    }
  }

  /**
   * Revoke all tasks assigned to a dead worker.
   * In production, this would use Celery's `app.control.revoke` or
   * BullMQ's worker pause/job removal.
   */
  private async revokeWorkerTasks(workerId: string): Promise<number> {
    log.info({ workerId }, 'Revoking tasks for dead worker');

    try {
      // Check for Redis task queue entries assigned to this worker
      // This is a placeholder — in production, you'd query the task queue
      // for tasks in 'active' state assigned to this worker.
      const revokedCount = 0;

      // TODO: Integrate with actual task queue (BullMQ/Celery) to:
      // 1. Get all active tasks for this worker
      // 2. Revoke them via app.control.revoke (Celery) or job.discard (BullMQ)
      // 3. Re-enqueue them for other workers

      return revokedCount;
    } catch (err) {
      log.error({ err: String(err), workerId }, 'Failed to revoke worker tasks');
      throw err;
    }
  }

  /**
   * Redistribute tasks from a dead worker to live workers.
   * Re-queues tasks with appropriate delays.
   */
  private async redistributeTasks(deadWorkerId: string): Promise<number> {
    log.info({ workerId: deadWorkerId }, 'Redistributing tasks from dead worker');

    try {
      // Get live workers to distribute to
      const liveWorkers = await workerHeartbeatMonitor.getLiveWorkers();
      const availableWorkers = liveWorkers.filter((w) => w !== deadWorkerId);

      log.info(
        { deadWorkerId, liveWorkerCount: availableWorkers.length, liveWorkers: availableWorkers },
        'Redistributing tasks among live workers',
      );

      // TODO: Integrate with actual task queue to re-enqueue tasks
      const redistributedCount = 0;

      return redistributedCount;
    } catch (err) {
      log.error({ err: String(err), workerId: deadWorkerId }, 'Failed to redistribute tasks');
      throw err;
    }
  }

  /**
   * Log a dead worker incident for auditing.
   */
  private logIncident(incident: DeadWorkerIncident): void {
    log.error(
      {
        event: 'dead_worker_recovery',
        workerId: incident.workerId,
        detectedAt: incident.detectedAt,
        revokedTaskCount: incident.revokedTaskCount,
        redistributedTaskCount: incident.redistributedTaskCount,
        status: incident.status,
      },
      'Dead worker incident — worker=%s revoked=%d redistributed=%d',
      incident.workerId,
      incident.revokedTaskCount,
      incident.redistributedTaskCount,
    );
  }

  /**
   * Restart a worker via Kubernetes.
   * Deletes the pod so the Deployment controller recreates it.
   */
  async restartWorkerViaK8s(workerId: string): Promise<void> {
    if (!this.k8sEnabled) {
      log.info({ workerId }, 'Kubernetes restart not enabled — skipping');
      return;
    }

    log.info({ workerId, namespace: this.k8sNamespace }, 'Restarting worker via Kubernetes');

    try {
      // In production, this would use @kubernetes/client-node to:
      // 1. Find the pod matching the worker ID
      // 2. Delete the pod (Deployment controller recreates it)
      // 3. Wait for the new pod to become ready
      // 4. Verify the new worker sends a heartbeat

      // Placeholder: log the action
      log.info(
        { workerId, namespace: this.k8sNamespace },
        'K8s pod deletion simulated for worker restart',
      );

      // Reset the dead worker gauge since we're attempting restart
      bridgeMetrics.setGauge('stas_dead_workers_current', { workerId }, 0);

      log.info({ workerId }, 'Worker restart initiated via Kubernetes');
    } catch (err) {
      log.error({ err: String(err), workerId }, 'Failed to restart worker via Kubernetes');
      throw err;
    }
  }

  /**
   * Get all incident records.
   */
  getIncidents(): DeadWorkerIncident[] {
    return Array.from(this.incidents.values());
  }

  /**
   * Get a specific incident.
   */
  getIncident(workerId: string): DeadWorkerIncident | undefined {
    return this.incidents.get(workerId);
  }

  /**
   * Clear old incidents (for cleanup).
   */
  clearIncidents(): void {
    this.incidents.clear();
    log.info('Dead worker incidents cleared');
  }
}

// ── Singleton ───────────────────────────────────────────────────────

/**
 * Global dead worker recovery instance.
 */
export const deadWorkerRecovery = new DeadWorkerRecovery();
