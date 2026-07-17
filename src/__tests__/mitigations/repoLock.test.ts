import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const LUA_SHA = 'mocked-sha';

const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  pttl: vi.fn().mockResolvedValue(-2),
  del: vi.fn().mockResolvedValue(1),
  script: vi.fn().mockResolvedValue(LUA_SHA),
  evalsha: vi.fn().mockResolvedValue(1),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  status: 'close' as string | undefined,
};

vi.mock('ioredis', () => ({
  Redis: vi.fn(function () {
    return mockRedis;
  }),
}));

describe('RepoLock', () => {
  let RepoLock: typeof import('../../mitigations/repoLock.js').RepoLock;
  let lock: import('../../mitigations/repoLock.js').RepoLock;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../mitigations/repoLock.js');
    RepoLock = mod.RepoLock;
    lock = new RepoLock('redis://localhost:6379');
  });

  it('acquires a lock with SETNX', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const acquired = await lock.acquire('owner', 'repo', 'pipeline-1');
    expect(acquired).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith('stas:lock:owner:repo', 'pipeline-1', 'PX', 30000, 'NX');
  });

  it('returns false when lock is already held', async () => {
    mockRedis.set.mockResolvedValue(null);
    const acquired = await lock.acquire('owner', 'repo', 'pipeline-2');
    expect(acquired).toBe(false);
  });

  it('releases a lock via Lua EVALSHA', async () => {
    mockRedis.evalsha.mockResolvedValue(1);
    const released = await lock.release('owner', 'repo', 'pipeline-1');
    expect(released).toBe(true);
    expect(mockRedis.evalsha).toHaveBeenCalledWith(LUA_SHA, 1, 'stas:lock:owner:repo', 'pipeline-1');
  });

  it('returns false when releasing unowned lock', async () => {
    mockRedis.evalsha.mockResolvedValue(0);
    const released = await lock.release('owner', 'repo', 'wrong-pipeline');
    expect(released).toBe(false);
  });

  it('isLocked returns true when lock exists', async () => {
    mockRedis.pttl.mockResolvedValue(20000);
    const locked = await lock.isLocked('owner', 'repo');
    expect(locked).toBe(true);
  });

  it('isLocked returns false when no lock', async () => {
    mockRedis.pttl.mockResolvedValue(-2);
    const locked = await lock.isLocked('owner', 'repo');
    expect(locked).toBe(false);
  });

  it('getLockOwner returns the pipeline ID', async () => {
    mockRedis.get.mockResolvedValue('pipeline-1');
    const owner = await lock.getLockOwner('owner', 'repo');
    expect(owner).toBe('pipeline-1');
  });

  it('acquire handles Redis errors gracefully', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis down'));
    const acquired = await lock.acquire('owner', 'repo', 'pipeline-1');
    expect(acquired).toBe(false);
  });

  it('close quits Redis connection', async () => {
    await lock.close();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
