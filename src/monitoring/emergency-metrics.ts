/**
 * Emergency Stop — Prometheus metrics.
 *
 * Exposes metrics for the emergency kill switch system so operators can
 * monitor activation state, task hold counts, and history.
 *
 * Metrics:
 *   - stas_emergency_stop_active        (gauge, 0|1)
 *   - stas_emergency_stop_activated_at  (gauge, unix timestamp)
 *   - stas_tasks_held                   (gauge, count per hold queue)
 *   - stas_tasks_routed_to_hold_total   (counter, per original queue)
 *   - stas_emergency_stop_events_total  (counter, per action type)
 *
 * These metrics are registered with the shared BridgeMetrics singleton
 * and rendered as part of the /metrics endpoint.
 *
 * Usage:
 *   import './emergency-metrics.js'; // auto-registers on import
 *   // or use the exported functions directly
 *   import { recordEmergencyStopEvent } from './emergency-metrics.js';
 *   recordEmergencyStopEvent('activate');
 */

import { bridgeMetrics } from '../bridge/metrics.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'emergency-metrics' });

// ---------------------------------------------------------------------------
// Metric Names (constants for consistency)
// ---------------------------------------------------------------------------

export const METRIC_EMERGENCY_STOP_ACTIVE = 'stas_emergency_stop_active';
export const METRIC_EMERGENCY_STOP_ACTIVATED_AT = 'stas_emergency_stop_activated_at';
export const METRIC_TASKS_HELD = 'stas_tasks_held';
export const METRIC_TASKS_ROUTED_TO_HOLD_TOTAL = 'stas_tasks_routed_to_hold_total';
export const METRIC_EMERGENCY_STOP_EVENTS_TOTAL = 'stas_emergency_stop_events_total';

// ---------------------------------------------------------------------------
// Metric recording functions
// ---------------------------------------------------------------------------

/**
 * Set the emergency stop active gauge (1 = active, 0 = inactive).
 */
export function setEmergencyStopActive(active: boolean): void {
  try {
    bridgeMetrics.setGauge(METRIC_EMERGENCY_STOP_ACTIVE, {}, active ? 1 : 0);
    log.debug({ active }, 'Emergency stop active metric updated');
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to set emergency stop active metric');
  }
}

/**
 * Record the timestamp when the emergency stop was activated.
 * @param timestamp - Unix timestamp in seconds
 */
export function setEmergencyStopActivatedAt(timestamp: number): void {
  try {
    bridgeMetrics.setGauge(METRIC_EMERGENCY_STOP_ACTIVATED_AT, {}, timestamp);
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to set emergency stop activated at metric');
  }
}

/**
 * Clear the activated-at timestamp (called on deactivation).
 */
export function clearEmergencyStopActivatedAt(): void {
  try {
    bridgeMetrics.setGauge(METRIC_EMERGENCY_STOP_ACTIVATED_AT, {}, 0);
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to clear emergency stop activated at metric');
  }
}

/**
 * Set the number of tasks currently held in a specific hold queue.
 *
 * @param queue - The hold queue name
 * @param count - Number of held tasks
 */
export function setTasksHeld(queue: string, count: number): void {
  try {
    bridgeMetrics.setGauge(METRIC_TASKS_HELD, { queue }, count);
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to set tasks held metric');
  }
}

/**
 * Increment the counter for tasks routed to the hold queue.
 *
 * @param originalQueue - The queue the task was originally destined for
 */
export function recordTaskRoutedToHold(originalQueue: string): void {
  try {
    bridgeMetrics.incrementCounter(METRIC_TASKS_ROUTED_TO_HOLD_TOTAL, { originalQueue });
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to record task routed to hold metric');
  }
}

/**
 * Record an emergency stop lifecycle event.
 *
 * @param action - The action type: 'activate' | 'deactivate' | 'hold' | 'resume'
 * @param labels - Optional additional labels
 */
export function recordEmergencyStopEvent(action: string, labels: Record<string, string> = {}): void {
  try {
    bridgeMetrics.incrementCounter(METRIC_EMERGENCY_STOP_EVENTS_TOTAL, {
      action,
      ...labels,
    });
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to record emergency stop event metric');
  }
}

// ---------------------------------------------------------------------------
// Convenience: lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Record all metrics for emergency stop activation.
 */
export function recordActivation(): void {
  setEmergencyStopActive(true);
  setEmergencyStopActivatedAt(Math.floor(Date.now() / 1000));
  recordEmergencyStopEvent('activate');
}

/**
 * Record all metrics for emergency stop deactivation.
 */
export function recordDeactivation(): void {
  setEmergencyStopActive(false);
  clearEmergencyStopActivatedAt();
  recordEmergencyStopEvent('deactivate');
}
