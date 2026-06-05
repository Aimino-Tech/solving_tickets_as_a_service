/**
 * Health module — re-exports all health, monitoring, and scheduled maintenance APIs.
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
