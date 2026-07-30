/**
 * Graceful Shutdown Manager
 *
 * Provides a centralized mechanism for graceful shutdown across API and worker
 * processes:
 *
 *   1. Listens for SIGTERM/SIGINT signals
 *   2. Sets shutting-down health status (health endpoint returns 503)
 *   3. Runs registered shutdown hooks (stops BullMQ workers, closes servers)
 *   4. Tracks in-flight tasks with a configurable drain timeout
 *   5. Forces exit after drain timeout if tasks haven't completed
 *   6. Logs each phase of shutdown
 *
 * Usage:
 *   import { shutdownManager } from './workers/shutdownManager.js';
 *
 *   // Register a shutdown hook
 *   shutdownManager.onShutdown(async () => { await worker.close(); });
 *
 *   // Track in-flight tasks
 *   const done = shutdownManager.registerTask(jobId, 'issue-processing');
 *   // ... do work ...
 *   done();  // marks task as completed
 *
 *   // Initiate shutdown (usually triggered by signal handler)
 *   process.on('SIGTERM', () => shutdownManager.shutdown('SIGTERM'));
 *
 *   // Check state (for health endpoint)
 *   const state = shutdownManager.getState();
 *   if (shutdownManager.isShuttingDown()) { res.status(503)... }
 *
 * --- Phase Logging ---------------------------------------------------
 * Phase 1: Signal received -> "Shutdown initiated"
 * Phase 2: Running shutdown hooks -> "Stopping workers/consumers"
 * Phase 3: Draining -> "Waiting for N in-flight tasks"
 * Phase 4: Drain timeout -> "Drain timeout reached -- forcing exit"
 * Phase 5: Completed -> "Graceful shutdown complete"
 * ---------------------------------------------------------------------
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

// -- Types -------------------------------------------------------------

export type ShutdownStatus = 'running' | 'shutting_down' | 'draining' | 'completed';

export interface ShutdownState {
  /** Current phase of the shutdown lifecycle */
  status: ShutdownStatus;
  /** ISO timestamp when shutdown was initiated, or null if not shutting down */
  startTime: string | null;
  /** Number of tasks still in-flight */
  inFlightTasks: number;
  /** Human-readable names of in-flight tasks */
  inFlightTaskNames: string[];
  /** Configured drain timeout in milliseconds */
  drainTimeoutMs: number;
}

/**
 * A shutdown hook is an async function called when shutdown begins.
 * Hooks should stop accepting new work (e.g. call worker.close()).
 */
type ShutdownHook = () => Promise<void>;

// -- Logger ------------------------------------------------------------

const log = rootLogger.child({ module: 'shutdown-manager' });

// -- ShutdownManager ---------------------------------------------------

class ShutdownManagerImpl {
  private status: ShutdownStatus = 'running';
  private inFlightTasks = new Map<string, { name: string; startTime: number }>();
  private shutdownStartTime: number | null = null;
  private drainTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private forceExitTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private shutdownHooks: ShutdownHook[] = [];
  private shutdownInProgress = false;
  private readonly drainTimeoutMs: number;
  private readonly forceExitTimeoutMs: number;

  constructor() {
    this.drainTimeoutMs = 30_000;
    this.forceExitTimeoutMs = 60_000;
  }

  // -- Task Registration -----------------------------------------------

  /**
   * Register a task as in-flight.
   *
   * @param taskId - Unique identifier for the task (e.g. job ID)
   * @param name   - Human-readable name for logging/health display
   * @returns An unregister function that marks the task as completed.
   *
   * @example
   * const done = shutdownManager.registerTask(job.id, 'process-issue');
   * try { await process(job); } finally { done(); }
   */
  registerTask(taskId: string, name: string): () => void {
    if (!this.inFlightTasks.has(taskId)) {
      this.inFlightTasks.set(taskId, { name, startTime: Date.now() });
      log.debug({ taskId, name }, 'Task registered as in-flight');
    }
    return () => this.completeTask(taskId);
  }

  /**
   * Manually mark a task as completed.
   * Prefer calling the unregister function returned by {@link registerTask}.
   */
  completeTask(taskId: string): void {
    const task = this.inFlightTasks.get(taskId);
    if (task) {
      this.inFlightTasks.delete(taskId);
      const duration = Date.now() - task.startTime;
      log.debug({ taskId, name: task.name, durationMs: duration }, 'In-flight task completed');

      // If we are draining and no tasks remain, finalize cleanly
      if (this.status === 'draining' && this.inFlightTasks.size === 0) {
        log.info('All in-flight tasks completed -- finalizing shutdown');
        this.finalizeShutdown();
      }
    }
  }

  /** Number of currently in-flight tasks. */
  get inFlightCount(): number {
    return this.inFlightTasks.size;
  }

  // -- Shutdown Hooks --------------------------------------------------

  /**
   * Register a shutdown hook.
   * Hooks are called in registration order when shutdown begins.
   * A hook should stop the component from accepting new work
   * (e.g. close a BullMQ worker, stop an HTTP server).
   */
  onShutdown(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook);
  }

  // -- Signal Handler --------------------------------------------------

  /**
   * Initiate graceful shutdown.
   *
   * Phases:
   *   1. **shutting_down** -- Stop accepting new work (run hooks)
   *   2. **draining** -- Wait for in-flight tasks to complete
   *   3. Drain timeout -> log warning, start force-exit countdown
   *   4. Force-exit timeout -> `process.exit(1)`
   *   5. All tasks done -> `process.exit(0)`
   *
   * Safe to call multiple times -- subsequent calls are no-ops.
   *
   * @param signal - The signal or reason for shutdown (e.g. 'SIGTERM', 'SIGINT')
   */
  async shutdown(signal: string): Promise<void> {
    if (this.shutdownInProgress) {
      log.debug({ signal }, 'Shutdown already in progress -- ignoring duplicate signal');
      return;
    }
    this.shutdownInProgress = true;

    this.shutdownStartTime = Date.now();
    this.status = 'shutting_down';

    log.info(
      {
        signal,
        drainTimeoutMs: this.drainTimeoutMs,
        forceExitTimeoutMs: this.forceExitTimeoutMs,
      },
      'Phase 1: Shutdown initiated -- stopping new task acceptance',
    );

    // Run all shutdown hooks (stops workers/consumers from accepting new tasks)
    await this.runShutdownHooks();

    // Transition to draining phase
    this.status = 'draining';
    const remainingTasks = this.inFlightTasks.size;

    if (remainingTasks === 0) {
      log.info('No in-flight tasks -- completing shutdown');
      this.finalizeShutdown();
      return;
    }

    log.info(
      {
        inFlightTasks: remainingTasks,
        taskNames: Array.from(this.inFlightTasks.values()).map((t) => t.name),
      },
      'Phase 3: Draining in-flight tasks',
    );

    // Start drain timeout -- if tasks haven't completed in time, force exit
    this.drainTimeoutId = setTimeout(() => {
      const stillRunning = this.inFlightTasks.size;
      const taskNames = Array.from(this.inFlightTasks.values()).map((t) => t.name);

      log.warn(
        {
          inFlightTasks: stillRunning,
          taskNames,
          drainTimeoutMs: this.drainTimeoutMs,
        },
        'Phase 4: Drain timeout reached -- some tasks did not complete',
      );

      // Give a final grace period before force-killing
      log.warn(
        { forceExitTimeoutMs: this.forceExitTimeoutMs },
        'Force exit timer started',
      );

      this.forceExitTimeoutId = setTimeout(() => {
        log.error(
          {
            inFlightTasks: this.inFlightTasks.size,
            taskNames: Array.from(this.inFlightTasks.values()).map((t) => t.name),
          },
          'Phase 5: Force exit timeout reached -- exiting immediately',
        );
        this.status = 'completed';
        // Use process.exit(1) to signal abnormal termination
        process.exit(1);
      }, this.forceExitTimeoutMs).unref();
    }, this.drainTimeoutMs).unref();
  }

  // -- Status Queries --------------------------------------------------

  /**
   * Whether the system is in the shutting_down or draining phase.
   * Health endpoints should return 503 when this is true.
   */
  isShuttingDown(): boolean {
    return this.status === 'shutting_down' || this.status === 'draining';
  }

  /**
   * Get the current shutdown state for health check reporting.
   */
  getState(): ShutdownState {
    return {
      status: this.status,
      startTime: this.shutdownStartTime ? new Date(this.shutdownStartTime).toISOString() : null,
      inFlightTasks: this.inFlightTasks.size,
      inFlightTaskNames: Array.from(this.inFlightTasks.values()).map((t) => t.name),
      drainTimeoutMs: this.drainTimeoutMs,
    };
  }

  // -- Private Helpers -------------------------------------------------

  /**
   * Run all registered shutdown hooks concurrently.
   * All hooks are awaited (via Promise.allSettled) so failures don't
   * block the shutdown sequence.
   */
  private async runShutdownHooks(): Promise<void> {
    const hooks = [...this.shutdownHooks];
    this.shutdownHooks = [];

    if (hooks.length === 0) {
      log.info('No shutdown hooks registered');
      return;
    }

    log.info({ hookCount: hooks.length }, 'Phase 2: Running shutdown hooks');

    const results = await Promise.allSettled(
      hooks.map(async (hook, i) => {
        try {
          await hook();
          log.debug({ hookIndex: i }, 'Shutdown hook completed');
        } catch (err) {
          log.error({ hookIndex: i, err: String(err) }, 'Shutdown hook failed');
          // Individual hook failures should not block the shutdown sequence
        }
      }),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      log.warn({ failedHooks: failed, totalHooks: hooks.length }, 'Some shutdown hooks failed');
    }

    log.info('All shutdown hooks completed');
  }

  /**
   * Finalize shutdown -- cancel timers, log duration, and exit.
   */
  private finalizeShutdown(): void {
    this.status = 'completed';

    if (this.drainTimeoutId) {
      clearTimeout(this.drainTimeoutId);
      this.drainTimeoutId = null;
    }
    if (this.forceExitTimeoutId) {
      clearTimeout(this.forceExitTimeoutId);
      this.forceExitTimeoutId = null;
    }

    const shutdownDuration = this.shutdownStartTime ? Date.now() - this.shutdownStartTime : 0;
    log.info(
      { shutdownDurationMs: shutdownDuration, inFlightTasksFinal: this.inFlightTasks.size },
      'Graceful shutdown complete -- exiting',
    );

    // Use setImmediate to give the log buffer a chance to flush
    setImmediate(() => {
      process.exit(0);
    });
  }
}

// -- Singleton ---------------------------------------------------------

/**
 * Global singleton instance of the ShutdownManager.
 *
 * Import and use this directly throughout the application:
 *
 *   import { shutdownManager } from './workers/shutdownManager.js';
 */
export const shutdownManager = new ShutdownManagerImpl();
