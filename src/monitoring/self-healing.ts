/**
 * Self-Healing Infrastructure — aggregates all self-healing monitors.
 *
 * Starts/stops the following monitors:
 *   - Worker heartbeat monitoring
 *   - Dead worker recovery
 *   - DLQ consumer
 *   - Timeout enforcement
 *   - Queue drain monitoring
 *   - Circuit breaker integration
 *
 * Usage:
 *   import { startSelfHealing, stopSelfHealing } from './monitoring/self-healing.js';
 *   await startSelfHealing();
 *   // ... application runs ...
 *   await stopSelfHealing();
 */

import { rootLogger } from '../utils/logger.js';
import { workerHeartbeatMonitor, startHeartbeatMonitor } from './heartbeat.js';
import { deadWorkerRecovery } from './dead-worker.js';
import { dlqConsumer } from '../queue/dlq.js';
import { timeoutEnforcer } from '../queue/timeout.js';
import { queueDrainMonitor } from '../queue/drain.js';
import { circuitBreaker } from '../circuit-breaker/index.js';

const log = rootLogger.child({ module: 'self-healing' });

// ── Configuration ───────────────────────────────────────────────────

export interface SelfHealingConfig {
  /** Heartbeat monitor interval in milliseconds. */
  heartbeatIntervalMs: number;
  /** Stuck task check interval in milliseconds. */
  stuckTaskIntervalMs: number;
  /** Queue drain check interval in milliseconds. */
  drainMonitorIntervalMs: number;
  /** Enable DLQ consumer. */
  enableDLQConsumer: boolean;
  /** Enable stuck task monitor. */
  enableStuckTaskMonitor: boolean;
  /** Enable queue drain monitor. */
  enableQueueDrainMonitor: boolean;
  /** Circuit breaker failure threshold. */
  circuitBreakerFailureThreshold: number;
  /** Circuit breaker reset timeout in milliseconds. */
  circuitBreakerResetTimeoutMs: number;
}

const DEFAULT_CONFIG: SelfHealingConfig = {
  heartbeatIntervalMs: 15_000, // 15 seconds
  stuckTaskIntervalMs: 30_000, // 30 seconds
  drainMonitorIntervalMs: 30_000, // 30 seconds
  enableDLQConsumer: true,
  enableStuckTaskMonitor: true,
  enableQueueDrainMonitor: true,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetTimeoutMs: 60_000,
};

// ── State ───────────────────────────────────────────────────────────

let isRunning = false;
let currentConfig: SelfHealingConfig = { ...DEFAULT_CONFIG };

// ── Start / Stop ────────────────────────────────────────────────────

/**
 * Start all self-healing monitors.
 */
export async function startSelfHealing(config?: Partial<SelfHealingConfig>): Promise<void> {
  if (isRunning) {
    log.warn('Self-healing infrastructure already running');
    return;
  }

  currentConfig = { ...DEFAULT_CONFIG, ...config };
  log.info({ config: currentConfig }, 'Starting self-healing infrastructure');

  try {
    // 1. Start heartbeat monitor
    log.info('Starting worker heartbeat monitor');
    startHeartbeatMonitor(currentConfig.heartbeatIntervalMs);

    // 2. Dead worker recovery is automatically wired via heartbeat events

    // 3. Start DLQ consumer
    if (currentConfig.enableDLQConsumer) {
      log.info('Starting DLQ consumer');
      dlqConsumer.consumeDLQ().catch((err) => {
        log.error({ err: String(err) }, 'Failed to start DLQ consumer');
      });
    }

    // 4. Start stuck task monitor
    if (currentConfig.enableStuckTaskMonitor) {
      log.info('Starting stuck task monitor');
      timeoutEnforcer.startStuckTaskMonitor(currentConfig.stuckTaskIntervalMs);
    }

    // 5. Start queue drain monitor
    if (currentConfig.enableQueueDrainMonitor) {
      log.info('Starting queue drain monitor');
      queueDrainMonitor.startMonitor(currentConfig.drainMonitorIntervalMs);
    }

    // 6. Circuit breaker is always active (no background loop needed)

    isRunning = true;
    log.info('Self-healing infrastructure started successfully');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to start self-healing infrastructure');
    // Attempt to clean up anything that was started
    await stopSelfHealing();
    throw err;
  }
}

/**
 * Stop all self-healing monitors gracefully.
 */
export async function stopSelfHealing(): Promise<void> {
  if (!isRunning) {
    log.warn('Self-healing infrastructure not running');
    return;
  }

  log.info('Stopping self-healing infrastructure');

  try {
    // Stop in reverse order of start

    // 1. Stop queue drain monitor
    queueDrainMonitor.stopMonitor();

    // 2. Stop stuck task monitor
    timeoutEnforcer.stopStuckTaskMonitor();

    // 3. Stop DLQ consumer
    await dlqConsumer.stop().catch((err) => {
      log.error({ err: String(err) }, 'Failed to stop DLQ consumer');
    });

    // 4. Stop heartbeat monitor
    workerHeartbeatMonitor.stopMonitor();

    // 5. Close Redis connections
    await workerHeartbeatMonitor.close().catch((err) => {
      log.error({ err: String(err) }, 'Failed to close heartbeat monitor');
    });
    await timeoutEnforcer.close().catch((err) => {
      log.error({ err: String(err) }, 'Failed to close timeout enforcer');
    });

    isRunning = false;
    log.info('Self-healing infrastructure stopped successfully');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to stop self-healing infrastructure');
    isRunning = false;
    throw err;
  }
}

/**
 * Check if the self-healing infrastructure is running.
 */
export function isSelfHealingRunning(): boolean {
  return isRunning;
}

/**
 * Get the monitoring status of all components.
 */
export function getSelfHealingStatus(): Record<string, unknown> {
  return {
    running: isRunning,
    config: currentConfig,
    liveWorkers: [], // Filled dynamically
    circuitStates: circuitBreaker.getSnapshot(),
    trackedTasks: timeoutEnforcer.getTrackedTasks().length,
  };
}
