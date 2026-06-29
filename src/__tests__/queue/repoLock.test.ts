import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: {
    setGauge: vi.fn(),
  },
}));

describe('repoLock', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearAllLocks } = await import('../../queue/repoLock.js');
    clearAllLocks();
  });

  it('acquires a lock successfully', async () => {
    const { acquireRepoLock } = await import('../../queue/repoLock.js');
    const result = await acquireRepoLock('test-key', 5000);
    expect(result).toBe(true);
  });

  it('rejects duplicate lock within TTL', async () => {
    const { acquireRepoLock } = await import('../../queue/repoLock.js');
    await acquireRepoLock('test-key', 5000);
    const result = await acquireRepoLock('test-key', 5000);
    expect(result).toBe(false);
  });

  it('releases a lock', async () => {
    const { acquireRepoLock, releaseRepoLock } = await import('../../queue/repoLock.js');
    await acquireRepoLock('test-key', 5000);
    await releaseRepoLock('test-key');
    const result = await acquireRepoLock('test-key', 5000);
    expect(result).toBe(true);
  });

  it('allows different lock keys independently', async () => {
    const { acquireRepoLock } = await import('../../queue/repoLock.js');
    await acquireRepoLock('key-a', 5000);
    const result = await acquireRepoLock('key-b', 5000);
    expect(result).toBe(true);
  });

  it('reports active lock count', async () => {
    const { acquireRepoLock, getActiveLockCount, releaseRepoLock } = await import('../../queue/repoLock.js');
    expect(getActiveLockCount()).toBe(0);
    await acquireRepoLock('key-1', 5000);
    await acquireRepoLock('key-2', 5000);
    expect(getActiveLockCount()).toBe(2);
    await releaseRepoLock('key-1');
    expect(getActiveLockCount()).toBe(1);
  });

  it('clears expired locks', async () => {
    const { acquireRepoLock, clearExpiredLocks, getActiveLockCount } = await import('../../queue/repoLock.js');
    await acquireRepoLock('expired-key', -1);
    const cleared = clearExpiredLocks();
    expect(cleared).toBe(1);
    expect(getActiveLockCount()).toBe(0);
  });
});
