import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('CleanupFinalizer', () => {
  let CleanupFinalizer: typeof import('../../mitigations/cleanup.js').CleanupFinalizer;
  let finalizer: import('../../mitigations/cleanup.js').CleanupFinalizer;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../mitigations/cleanup.js');
    CleanupFinalizer = mod.CleanupFinalizer;
    finalizer = new CleanupFinalizer();
  });

  it('runs cleanup after main function succeeds', async () => {
    const cleanupFn = vi.fn().mockResolvedValue(undefined);
    const result = await finalizer.executeWithCleanup(
      'pipeline-1',
      async () => 'success',
      cleanupFn,
    );

    expect(result).toBe('success');
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('runs cleanup when main function throws', async () => {
    const cleanupFn = vi.fn().mockResolvedValue(undefined);
    const mainFn = vi.fn().mockRejectedValue(new Error('pipeline failed'));

    await expect(
      finalizer.executeWithCleanup('pipeline-2', mainFn, cleanupFn),
    ).rejects.toThrow('pipeline failed');

    expect(cleanupFn).toHaveBeenCalledTimes(1);
    expect(mainFn).toHaveBeenCalledTimes(1);
  });

  it('runs cleanup only once (idempotent)', async () => {
    const cleanupFn = vi.fn().mockResolvedValue(undefined);

    await finalizer.executeWithCleanup('pipeline-3', async () => 'ok', cleanupFn);
    expect(cleanupFn).toHaveBeenCalledTimes(1);

    // Second call to runCleanup should be no-op
    await finalizer.runCleanup('pipeline-3');
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('handles multiple cleanups registered separately', async () => {
    const cleanup1 = vi.fn().mockResolvedValue(undefined);
    const cleanup2 = vi.fn().mockResolvedValue(undefined);

    finalizer.registerCleanup('pipeline-4', cleanup1);
    finalizer.registerCleanup('pipeline-4', cleanup2);

    await finalizer.runCleanup('pipeline-4');

    // LIFO order: cleanup2 runs first
    expect(cleanup2).toHaveBeenCalledBefore(cleanup1);
    expect(cleanup1).toHaveBeenCalledTimes(1);
    expect(cleanup2).toHaveBeenCalledTimes(1);
  });

  it('throws AggregateError when cleanup itself fails', async () => {
    const badCleanup = vi.fn().mockRejectedValue(new Error('cleanup error'));

    await expect(
      finalizer.executeWithCleanup('pipeline-5', async () => 'ok', badCleanup),
    ).rejects.toThrow('1 cleanup finalizer(s) failed');
  });

  it('hasCompleted returns true after successful cleanup', async () => {
    expect(finalizer.hasCompleted('pipeline-6')).toBe(false);
    await finalizer.executeWithCleanup('pipeline-6', async () => 'ok');
    expect(finalizer.hasCompleted('pipeline-6')).toBe(true);
  });

  it('executeWithCleanup without explicit cleanupFn works', async () => {
    const result = await finalizer.executeWithCleanup(
      'pipeline-7',
      async () => 42,
    );
    expect(result).toBe(42);
  });

  it('reset clears all state', async () => {
    await finalizer.executeWithCleanup('pipeline-8', async () => 'ok');
    expect(finalizer.hasCompleted('pipeline-8')).toBe(true);

    finalizer.reset();
    expect(finalizer.hasCompleted('pipeline-8')).toBe(false);
  });

  it('no cleanups for unknown pipeline is a no-op', async () => {
    await expect(finalizer.runCleanup('unknown')).resolves.toBeUndefined();
  });
});
