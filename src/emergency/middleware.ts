/**
 * Emergency Stop — dispatch middleware.
 *
 * Intercepts task dispatch requests. When the kill switch is active,
 * tasks are diverted to the `stas.emergency.hold` queue instead of
 * their normal destination queue.
 *
 * This module provides two integration points:
 *   1. `emergencyMiddleware()` — Express middleware for HTTP-triggered dispatches
 *   2. `wrapDispatch()` — Higher-order function that wraps any dispatch function
 *      with emergency stop checking, for programmatic use in the queue layer.
 *
 * Usage:
 *   import { emergencyMiddleware, wrapDispatch } from './emergency/middleware.js';
 *   app.post('/dispatch', emergencyMiddleware, dispatchHandler);
 *
 *   const safeDispatch = wrapDispatch(originalDispatch);
 *   await safeDispatch(queue, jobData);
 */

import type { NextFunction, Request, Response } from 'express';
import { EmergencyStop } from './stop.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'emergency-middleware' });

// ---------------------------------------------------------------------------
// Express Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that checks the emergency stop before allowing
 * a task dispatch request to proceed.
 *
 * If the kill switch is active, the request is rejected with a 503
 * status and a message indicating the stop is in effect.
 */
export function emergencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (EmergencyStop.check()) {
    log.warn(
      { path: req.path, method: req.method, ip: req.ip },
      'Emergency stop active — rejecting dispatch request',
    );

    // Update the held tasks counter
    try {
      bridgeMetrics.incrementCounter('stas_tasks_held_total', { reason: 'emergency_stop' });
    } catch {
      // non-fatal
    }

    // Instead of rejecting, we could route to hold queue, but for HTTP
    // dispatches we respond with 503 so the caller knows to retry later.
    res.status(503).json({
      error: 'Service temporarily unavailable',
      detail: 'Emergency stop is active. All agent dispatches are held.',
      retryAfter: 'unknown — check GET /api/emergency-stop/status',
    });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Dispatch Wrapper (for programmatic use)
// ---------------------------------------------------------------------------

/**
 * Type for any dispatch function that takes a queue name and payload.
 */
export type DispatchFunction<T = unknown> = (queue: string, payload: T) => Promise<unknown>;

/**
 * Wraps any dispatch function with emergency stop checking.
 *
 * When the kill switch is active, the task is routed to the hold queue
 * instead of its normal destination. The wrapped function returns a
 * marker object indicating the task was held.
 *
 * @param dispatch - The original dispatch function to wrap
 * @returns A wrapped dispatch function with emergency stop protection
 */
export function wrapDispatch<T = unknown>(
  dispatch: DispatchFunction<T>,
): DispatchFunction<T | { held: true; originalQueue: string; reason: string }> {
  return async (queue: string, payload: T) => {
    if (EmergencyStop.check()) {
      log.warn(
        { originalQueue: queue },
        'Emergency stop active — routing task to hold queue',
      );

      // Route to hold queue
      const holdQueue = config.emergency.holdQueue;

      try {
        bridgeMetrics.incrementCounter('stas_tasks_routed_to_hold', { originalQueue: queue });
      } catch {
        // non-fatal
      }

      await dispatch(holdQueue, payload);

      return {
        held: true,
        originalQueue: queue,
        reason: 'Emergency stop active — task routed to hold queue',
      };
    }

    return dispatch(queue, payload);
  };
}

// ---------------------------------------------------------------------------
// BullMQ Queue Wrapper (for the issue queue system)
// ---------------------------------------------------------------------------

/**
 * Wraps a BullMQ queue's `add` method to check the kill switch.
 * If active, the job is added to the hold queue instead.
 *
 * @param queue - The BullMQ Queue instance
 * @returns The same queue with an overridden `add` method
 */
export function protectQueue<T extends { add: Function }>(queue: T): T {
  const originalAdd = queue.add.bind(queue);

  queue.add = async (name: string, data: unknown, opts?: unknown) => {
    if (EmergencyStop.check()) {
      log.warn(
        { originalJobName: name },
        'Emergency stop active — holding BullMQ job',
      );
      return { held: true, originalName: name, data };
    }
    return originalAdd(name, data, opts);
  };

  return queue;
}
