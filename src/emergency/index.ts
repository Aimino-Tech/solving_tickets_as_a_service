/**
 * Emergency Kill Switch — barrel exports.
 *
 * Aggregates all emergency stop module exports for convenient importing.
 *
 * Usage:
 *   import { EmergencyStop, emergencyRouter, emergencyMiddleware } from './emergency/index.js';
 */

export { EmergencyStop } from './stop.js';
export type { EmergencyStopStatus } from './stop.js';

export { emergencyMiddleware, wrapDispatch, protectQueue } from './middleware.js';
export type { DispatchFunction } from './middleware.js';

export { emergencyRouter } from './routes.js';

export { notifyActiveIssues, registerActiveIssue, unregisterActiveIssue, getActiveIssues } from './notify.js';

export { holdPendingMessages, resumeHeldMessages, getHeldMessageCount } from './queue.js';
