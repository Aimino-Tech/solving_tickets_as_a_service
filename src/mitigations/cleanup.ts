/**
 * Cleanup finalizer — guarantees cleanup runs after pipeline execution
 * regardless of success or failure (Promise.finally semantics).
 *
 * Usage:
 *   const finalizer = new CleanupFinalizer();
 *
 *   // Register cleanup in advance
 *   finalizer.registerCleanup('pipeline-123', () => releaseLock('repo'));
 *
 *   // Or wrap execution
 *   const result = await finalizer.executeWithCleanup(
 *     'pipeline-123',
 *     () => mainPipelineLogic(),
 *     () => releaseLock('repo'),
 *   );
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'cleanup-finalizer' });

type CleanupFn = () => void | Promise<void>;

export class CleanupFinalizer {
  private readonly cleanups: Map<string, CleanupFn[]> = new Map();
  private readonly completed: Set<string> = new Set();

  /**
   * Register a cleanup function for a given pipeline.
   * Multiple cleanups can be registered per pipeline — they run in LIFO order.
   */
  registerCleanup(pipelineId: string, fn: CleanupFn): void {
    const existing = this.cleanups.get(pipelineId) ?? [];
    existing.push(fn);
    this.cleanups.set(pipelineId, existing);
  }

  /**
   * Execute the main function and guarantee cleanup runs afterwards.
   *
   * @param pipelineId - Pipeline identifier
   * @param mainFn - The primary pipeline logic
   * @param cleanupFn - Optional cleanup to register before execution
   * @returns The result of mainFn
   */
  async executeWithCleanup<T>(
    pipelineId: string,
    mainFn: () => T | Promise<T>,
    cleanupFn?: CleanupFn,
  ): Promise<T> {
    if (cleanupFn) {
      this.registerCleanup(pipelineId, cleanupFn);
    }

    try {
      const result = await mainFn();
      return result;
    } finally {
      await this.runCleanup(pipelineId);
    }
  }

  /**
   * Run all registered cleanups for a pipeline and remove them.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async runCleanup(pipelineId: string): Promise<void> {
    if (this.completed.has(pipelineId)) return;
    this.completed.add(pipelineId);

    const fns = this.cleanups.get(pipelineId);
    if (!fns || fns.length === 0) {
      log.debug({ pipelineId }, 'No cleanups registered for pipeline');
      return;
    }

    // Run in LIFO order (last registered = first cleaned up)
    log.info({ pipelineId, count: fns.length }, 'Running cleanup finalizers');

    const errors: Error[] = [];
    for (let i = fns.length - 1; i >= 0; i--) {
      try {
        await fns[i]();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        errors.push(e);
        log.error({ err: e, pipelineId, index: i }, 'Cleanup finalizer failed');
      }
    }

    this.cleanups.delete(pipelineId);

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} cleanup finalizer(s) failed for pipeline ${pipelineId}`,
      );
    }
  }

  /**
   * Check if a pipeline has completed its cleanup.
   */
  hasCompleted(pipelineId: string): boolean {
    return this.completed.has(pipelineId);
  }

  /**
   * Reset state (for testing).
   */
  reset(): void {
    this.cleanups.clear();
    this.completed.clear();
  }
}
