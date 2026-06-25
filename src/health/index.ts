/**
 * Health module - re-exports all health, monitoring, and scheduled maintenance APIs.
 */

export {
  getQueueHealth,
  hasCriticalQueues,
  getDLQSummary,
  closeHealthRedis,
} from './queueHealth.js';

export type {
  QueueHealthReport,
  QueueHealthEntry,
} from './queueHealth.js';

export {
  startScheduledTasks,
  stopScheduledTasks,
} from './scheduled.js';

export { bridgeMetrics } from '../bridge/metrics.js';

export { opencodeHealth } from './opencodeHealth.js';
export type { OpenCodeHealthStatus } from './opencodeHealth.js';

export { getWorkersHealth } from './workers.js';
export type { WorkersHealthReport } from './workers.js';

export { getDependenciesHealth } from './dependencies.js';
export type { DependenciesHealthReport, DependencyCheckResult } from './dependencies.js';

// AIM-2022: Self-Healing Infrastructure
export {
  checkCircuit,
  recordFailure,
  recordSuccess,
  getState,
  getAllCircuits,
  resetCircuit,
} from '../monitoring/circuitBreaker.js';

export type {
  CircuitState,
  CircuitInfo,
} from '../monitoring/circuitBreaker.js';

export {
  checkQueueDrain,
  startQueueDrainMonitor,
  stopQueueDrainMonitor,
} from '../queue/queueMonitor.js';

export type {
  QueueDrainResult,
} from '../queue/queueMonitor.js';
