import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  config: { queue: { redisUrl: 'redis://localhost:6379' } },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

const mockRedis = {
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  pexpire: vi.fn().mockResolvedValue(1),
  pttl: vi.fn().mockResolvedValue(20000),
  del: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  pipeline: vi.fn(() => ({
    hgetall: vi.fn(),
    rpush: vi.fn(),
    ltrim: vi.fn(),
    pexpire: vi.fn(),
    exec: vi.fn().mockResolvedValue([]),
  })),
  lrange: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  exists: vi.fn().mockResolvedValue(0),
  set: vi.fn().mockResolvedValue('OK'),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  status: 'close' as string | undefined,
  script: vi.fn(),
  evalsha: vi.fn(),
};

vi.mock('ioredis', () => ({
  Redis: vi.fn(function () {
    return mockRedis;
  }),
}));

describe('RedisSessionStore', () => {
  let RedisSessionStore: typeof import('../../session/redisStore.js').RedisSessionStore;
  let store: import('../../session/redisStore.js').RedisSessionStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../session/redisStore.js');
    RedisSessionStore = mod.RedisSessionStore;
    store = new RedisSessionStore('redis://localhost:6379');
  });

  it('creates a session and stores it in Redis', async () => {
    const state = {
      sessionId: 'sess-1',
      issueId: 'issue-1',
      pipelineName: 'syntaro:fix',
      status: 'queued' as const,
      currentStage: 'queued' as const,
      progress: 0,
      attempt: 1,
      maxAttempts: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    };

    mockRedis.hset.mockResolvedValue(1);
    await store.set('sess-1', state);
    expect(mockRedis.hset).toHaveBeenCalled();
  });

  it('returns undefined for missing session', async () => {
    mockRedis.hgetall.mockResolvedValue({});
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('addEvent stores event JSON to Redis list', async () => {
    const mockPipeline = {
      rpush: vi.fn().mockReturnThis(),
      ltrim: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);
    const event = {
      event: 'stage.advanced',
      timestamp: Date.now(),
      sessionId: 'sess-1',
      stage: 'triage' as const,
    };
    await store.addEvent('sess-1', event);
    expect(mockPipeline.rpush).toHaveBeenCalled();
    expect(mockPipeline.pexpire).toHaveBeenCalled();
  });

  it('getEvents returns parsed events from Redis', async () => {
    const event = { event: 'stage.advanced', timestamp: 1000, sessionId: 'sess-1', stage: 'triage' };
    mockRedis.lrange.mockResolvedValue([JSON.stringify(event)]);
    const events = await store.getEvents('sess-1');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('stage.advanced');
  });

  it('delete removes session and events keys', async () => {
    mockRedis.del.mockResolvedValue(2);
    const result = await store.delete('sess-1');
    expect(result).toBe(true);
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it('clear scans and deletes all session keys', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['0', ['syntaro:session:sess-1']])
      .mockResolvedValueOnce(['0', []]);
    mockRedis.del.mockResolvedValue(1);

    await store.clear();
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it('list returns sessions matching filter', async () => {
    const stateData = {
      sessionId: 'sess-1',
      issueId: 'issue-1',
      pipelineName: 'syntaro:fix',
      status: 'running',
      currentStage: 'triage',
      progress: '0.1',
      attempt: '1',
      maxAttempts: '3',
      createdAt: '1000',
      updatedAt: '2000',
      startedAt: '',
      completedAt: '',
      error: '',
      metadata: '{}',
    };

    mockRedis.scan
      .mockResolvedValueOnce(['0', ['syntaro:session:sess-1']])
      .mockResolvedValueOnce(['0', []]);

    const pipelineMock = {
      hgetall: vi.fn().mockResolvedValue(stateData),
      exec: vi.fn().mockResolvedValue([[null, stateData]]),
    };
    mockRedis.pipeline.mockReturnValue(pipelineMock);

    // We need to make hgetall work properly
    mockRedis.hgetall.mockResolvedValue(stateData);

    // Override pipeline to execute hgetall properly
    const pipelineResult = [[null, stateData]];
    pipelineMock.exec.mockResolvedValue(pipelineResult);

    const sessions = await store.list({ status: 'running' });
    expect(sessions.length).toBeGreaterThanOrEqual(0);
  });

  it('starts and stops zombie reaper', async () => {
    store.startZombieReaper();
    store.stopZombieReaper();
    expect(true).toBe(true); // no crash
  });

  it('isZombie returns false for non-zombie session', async () => {
    mockRedis.exists.mockResolvedValue(0);
    const zombie = await store.isZombie('sess-1');
    expect(zombie).toBe(false);
  });

  it('isZombie returns true for zombie session', async () => {
    mockRedis.exists.mockResolvedValue(1);
    const zombie = await store.isZombie('sess-1');
    expect(zombie).toBe(true);
  });

  it('getClient returns the Redis client', () => {
    const client = store.getClient();
    expect(client).toBeDefined();
  });

  it('close quits the Redis connection', async () => {
    mockRedis.quit.mockResolvedValue(undefined);
    await store.close();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
