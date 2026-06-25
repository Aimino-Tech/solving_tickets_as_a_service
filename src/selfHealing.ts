import { Queue } from 'bullmq';
import { config } from './config.js';
import { checkWorkerHeartbeats, dispatchAlert, getWorkerHeartbeatStatus, removeWorkerHeartbeat, reportWorkerDown } from './monitoring/alerting.js';
import { rootLogger } from './utils/logger.js';
import { Worker as BullWorker } from 'bullmq';

const log = rootLogger.child({ module: 'self-healing' });

const QUEUE_NAME = 'stas-issues';
const DLQ_NAME = 'stas-issues-dlq';

function redisConnectionOptions() {
  return {
    url: config.queue.redisUrl || 'redis://localhost:6379',
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
  };
}

export class CircuitBreaker {
  private failures: number;
  private lastFailureTime: number;
  readonly name: string;
  readonly threshold: number;
  readonly resetTimeoutMs: number;
  private state: 'closed' | 'open' | 'half-open';

  constructor(name: string, threshold: number = 5, resetTimeoutMs: number = 30000) {
    this.name = name;
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.state === 'closed' && this.failures >= this.threshold) {
      this.state = 'open';
      log.error({ breaker: this.name, failures: this.failures }, 'Circuit breaker OPEN — blocking operations');
      dispatchAlert({
        severity: 'critical',
        rule: `circuit_breaker_open_${this.name}`,
        message: `Circuit breaker "${this.name}" opened after ${this.failures} failures`,
        context: { breaker: this.name, failures: this.failures, threshold: this.threshold },
        timestamp: new Date().toISOString(),
      });
    }
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.state = 'closed';
      log.info({ breaker: this.name }, 'Circuit breaker CLOSED — operations restored');
      dispatchAlert({
        severity: 'info',
        rule: `circuit_breaker_closed_${this.name}`,
        message: `Circuit breaker "${this.name}" closed after successful operation`,
        context: { breaker: this.name },
        timestamp: new Date().toISOString(),
      });
    }
    this.failures = 0;
  }

  tryReset(): boolean {
    if (this.state === 'open' && (Date.now() - this.lastFailureTime) > this.resetTimeoutMs) {
      this.state = 'half-open';
      log.info({ breaker: this.name }, 'Circuit breaker HALF-OPEN — allowing test request');
      return true;
    }
    return this.state !== 'open';
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  getState(): string {
    return this.state;
  }

  getFailureCount(): number {
    return this.failures;
  }
}

export class DeadWorkerRecovery {
  private recoveryAttempts: Map<string, number>;
  private readonly maxRecoveryAttempts: number;

  constructor(maxRecoveryAttempts: number = 3) {
    this.recoveryAttempts = new Map();
    this.maxRecoveryAttempts = maxRecoveryAttempts;
  }

  checkAndRecover(): void {
    const workers = getWorkerHeartbeatStatus();
    const now = Date.now();

    for (const worker of workers) {
      if (worker.isAlive) {
        this.recoveryAttempts.delete(worker.workerId);
        continue;
      }

      const attempts = this.recoveryAttempts.get(worker.workerId) ?? 0;
      if (attempts >= this.maxRecoveryAttempts) {
        log.error(
          { workerId: worker.workerId, attempts },
          'Worker exceeded max recovery attempts — removing from heartbeat tracking',
        );
        removeWorkerHeartbeat(worker.workerId);
        dispatchAlert({
          severity: 'critical',
          rule: 'worker_unrecoverable',
          message: `Worker "${worker.workerId}" unrecoverable after ${attempts} attempts`,
          context: { workerId: worker.workerId, attempts },
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      log.warn(
        { workerId: worker.workerId, secondsSinceHeartbeat: worker.secondsSinceHeartbeat, attempt: attempts + 1 },
        'Attempting dead worker recovery',
      );
      this.recoveryAttempts.set(worker.workerId, attempts + 1);
      reportWorkerDown(worker.workerId, worker.secondsSinceHeartbeat);
    }
  }

  resetRecovery(workerId: string): void {
    this.recoveryAttempts.delete(workerId);
  }
}

export class QueueDrainManager {
  private readonly drainBreaker: CircuitBreaker;

  constructor() {
    this.drainBreaker = new CircuitBreaker('queue-drain', 3, 60000);
  }

  async drainFailedJobs(maxAgeMs: number = 86400000): Promise<{ drained: number; errors: string[] }> {
    if (!this.drainBreaker.tryReset()) {
      log.warn('Queue drain circuit breaker is OPEN — skipping drain');
      return { drained: 0, errors: ['Circuit breaker open'] };
    }

    const errors: string[] = [];
    let drained = 0;

    try {
      const queue = new Queue(QUEUE_NAME, { connection: redisConnectionOptions() });
      try {
        const failedJobs = await queue.getFailed();
        const cutoff = Date.now() - maxAgeMs;
        let drainedFromFail = 0;

        for (const job of failedJobs) {
          if (job.timestamp && job.timestamp < cutoff) {
            await job.remove();
            drainedFromFail++;
          }
        }
        drained += drainedFromFail;
        log.info({ drained: drainedFromFail, maxAgeMs }, 'Drained old failed jobs from main queue');
      } finally {
        await queue.close();
      }
    } catch (err) {
      errors.push(`Main queue drain error: ${String(err)}`);
      this.drainBreaker.recordFailure();
    }

    try {
      const dlq = new Queue(DLQ_NAME, { connection: redisConnectionOptions() });
      try {
        const dlqJobs = await dlq.getJobs();
        const cutoff = Date.now() - maxAgeMs;
        let drainedFromDlq = 0;

        for (const job of dlqJobs) {
          if (job.timestamp && job.timestamp < cutoff) {
            await job.remove();
            drainedFromDlq++;
          }
        }
        drained += drainedFromDlq;
        log.info({ drained: drainedFromDlq, maxAgeMs }, 'Drained old jobs from DLQ');
      } finally {
        await dlq.close();
      }
    } catch (err) {
      errors.push(`DLQ drain error: ${String(err)}`);
      this.drainBreaker.recordFailure();
    }

    if (errors.length === 0) {
      this.drainBreaker.recordSuccess();
    }

    return { drained, errors };
  }

  async clearAllStuckJobs(): Promise<{ cleared: number }> {
    let cleared = 0;

    try {
      const queue = new Queue(QUEUE_NAME, { connection: redisConnectionOptions() });
      try {
        const waiting = await queue.getWaiting();
        for (const job of waiting) {
          const state = await job.getState();
          if (state === 'waiting' || state === 'paused') {
            const now = Date.now();
            if (job.timestamp && (now - job.timestamp) > 3600000) {
              const processed = await queue.getJobs();
              const oldWaiting = processed.filter((j) => j.timestamp && (now - j.timestamp) > 3600000);
              for (const j of oldWaiting) {
                await j.remove();
                cleared++;
              }
              break;
            }
          }
        }
      } finally {
        await queue.close();
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to clear stuck jobs');
    }

    return { cleared };
  }
}

export class SelfHealingManager {
  private intervalHandle: ReturnType<typeof setInterval> | null;
  private readonly checkIntervalMs: number;
  private readonly deadWorkerRecovery: DeadWorkerRecovery;
  private readonly queueDrainManager: QueueDrainManager;
  private readonly overallCircuitBreaker: CircuitBreaker;

  constructor(checkIntervalMs: number = 60000) {
    this.checkIntervalMs = checkIntervalMs;
    this.intervalHandle = null;
    this.deadWorkerRecovery = new DeadWorkerRecovery();
    this.queueDrainManager = new QueueDrainManager();
    this.overallCircuitBreaker = new CircuitBreaker('self-healing-overall', 10, 120000);
  }

  start(): void {
    if (this.intervalHandle) {
      log.warn('Self-healing manager already running');
      return;
    }

    log.info({ checkIntervalMs: this.checkIntervalMs }, 'Starting self-healing manager');

    this.runHealingCycle().catch((err) => {
      log.error({ err: String(err) }, 'Initial self-healing cycle failed');
    });

    this.intervalHandle = setInterval(() => {
      this.runHealingCycle().catch((err) => {
        log.error({ err: String(err) }, 'Self-healing cycle failed');
      });
    }, this.checkIntervalMs);

    if (this.intervalHandle && typeof this.intervalHandle === 'object' && 'unref' in this.intervalHandle) {
      this.intervalHandle.unref();
    }

    log.info('Self-healing manager started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log.info('Self-healing manager stopped');
    }
  }

  private async runHealingCycle(): Promise<void> {
    if (!this.overallCircuitBreaker.tryReset()) {
      log.warn('Self-healing circuit breaker is OPEN — skipping cycle');
      return;
    }

    log.debug('Running self-healing cycle');

    try {
      this.deadWorkerRecovery.checkAndRecover();
    } catch (err) {
      log.error({ err: String(err) }, 'Dead worker recovery failed');
      this.overallCircuitBreaker.recordFailure();
    }

    try {
      checkWorkerHeartbeats(120);
    } catch (err) {
      log.error({ err: String(err) }, 'Worker heartbeat check failed');
    }

    try {
      const drainResult = await this.queueDrainManager.drainFailedJobs(86400000);
      if (drainResult.drained > 0) {
        log.info({ drained: drainResult.drained }, 'Queue drain completed');
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Queue drain failed');
      this.overallCircuitBreaker.recordFailure();
    }

    try {
      const stuckResult = await this.queueDrainManager.clearAllStuckJobs();
      if (stuckResult.cleared > 0) {
        log.info({ cleared: stuckResult.cleared }, 'Stuck jobs cleared');
      }
    } catch (err) {
      log.error({ err: String(err) }, 'Stuck job clearance failed');
    }

    this.overallCircuitBreaker.recordSuccess();
  }
}
