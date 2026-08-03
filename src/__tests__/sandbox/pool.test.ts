import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}));

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock('node:fs', () => ({
  mkdtempSync: vi.fn(() => '/tmp/syntaro-sandbox-pool-test-xxxxxx'),
  existsSync: vi.fn(() => true),
  rmSync: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  config: {
    docker: {
      image: 'ubuntu:22.04',
      containerMemory: '2g',
      containerCpu: 2,
      networkRestrict: false,
      allowedHosts: [],
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue(mockLogger),
  },
}));

import { SandboxPool } from '../../sandbox/pool.js';
import type { PoolConfig } from '../../sandbox/pool.js';

function makePoolConfig(overrides: Partial<PoolConfig> = {}): PoolConfig {
  return {
    maxIdle: overrides.maxIdle ?? 0,
    maxTotal: overrides.maxTotal ?? 2,
    ttlMs: overrides.ttlMs ?? 300_000,
  };
}

type DockerCall = { stdout: string; status?: number };

function queueDockerCalls(calls: DockerCall[]) {
  const defaultVal = { stdout: '', stderr: '', status: 0, pid: 1, output: ['', ''], signal: null };
  for (const c of calls) {
    mockSpawnSync.mockReturnValueOnce({
      stdout: c.stdout,
      stderr: '',
      status: c.status ?? 0,
      pid: 1,
      output: [c.stdout, ''],
      signal: null,
    });
  }
  mockSpawnSync.mockReturnValue(defaultVal);
}

describe('SandboxPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
    mockSpawnSync.mockReset();
  });

  describe('acquire', () => {
    it('creates a fresh container when warm pool is empty and returns DockerSandbox', async () => {
      queueDockerCalls([
        { stdout: '', status: 1 },
        { stdout: 'container-1' },
        { stdout: '' },
        { stdout: '' },
        { stdout: 'package.json\ntsconfig.json' },
        { stdout: '{}' },
        { stdout: '' },
      ]);

      const pool = new SandboxPool(makePoolConfig());
      const getToken = vi.fn().mockResolvedValue('mock-token');

      const sandbox = await pool.acquire(
        'https://github.com/owner/repo.git',
        'owner',
        'repo',
        123,
        getToken,
      );

      expect(sandbox).toBeDefined();
      expect(pool.activeCountValue()).toBe(1);
      expect(pool.idleCount()).toBe(0);
    });

    it('throws when maxTotal is exceeded', async () => {
      queueDockerCalls([
        { stdout: '', status: 1 },
        { stdout: 'container-1' },
        { stdout: '' },
        { stdout: '' },
        { stdout: 'package.json\ntsconfig.json' },
        { stdout: '{}' },
        { stdout: '' },
      ]);

      const pool = new SandboxPool(makePoolConfig({ maxTotal: 1 }));
      const getToken = vi.fn().mockResolvedValue('mock-token');
      await pool.acquire('https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken);

      await expect(
        pool.acquire('https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken),
      ).rejects.toThrow('All sandboxes in use');
    });
  });

  describe('release', () => {
    it('returns sandbox to warm pool when under maxIdle', async () => {
      queueDockerCalls([
        { stdout: '', status: 1 },
        { stdout: 'container-1' },
        { stdout: '' },
        { stdout: '' },
        { stdout: 'package.json\ntsconfig.json' },
        { stdout: '{}' },
        { stdout: '' },
        { stdout: '' },
      ]);

      const pool = new SandboxPool(makePoolConfig({ maxIdle: 1, maxTotal: 2 }));
      const getToken = vi.fn().mockResolvedValue('mock-token');
      const sandbox = await pool.acquire(
        'https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken,
      );

      expect(pool.activeCountValue()).toBe(1);

      await pool.release(sandbox);

      expect(pool.activeCountValue()).toBe(0);
      expect(pool.idleCount()).toBe(1);
    });

    it('destroys sandbox when warm pool is full', async () => {
      queueDockerCalls([
        { stdout: '', status: 1 },
        { stdout: 'container-1' },
        { stdout: '' },
        { stdout: '' },
        { stdout: 'package.json\ntsconfig.json' },
        { stdout: '{}' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
      ]);

      const pool = new SandboxPool(makePoolConfig({ maxIdle: 0, maxTotal: 2 }));
      const getToken = vi.fn().mockResolvedValue('mock-token');
      const sandbox = await pool.acquire(
        'https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken,
      );

      await pool.release(sandbox);

      expect(pool.activeCountValue()).toBe(0);
      expect(pool.idleCount()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('stops and removes all warm containers', async () => {
      queueDockerCalls([
        { stdout: '', status: 1 },
        { stdout: 'container-1' },
        { stdout: '' },
        { stdout: '' },
        { stdout: 'package.json\ntsconfig.json' },
        { stdout: '{}' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
      ]);

      const pool = new SandboxPool(makePoolConfig({ maxIdle: 1, maxTotal: 2 }));
      const getToken = vi.fn().mockResolvedValue('mock-token');
      const sandbox = await pool.acquire(
        'https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken,
      );

      await pool.release(sandbox);

      await pool.destroy();

      expect(pool.idleCount()).toBe(0);
      expect(pool.activeCountValue()).toBe(0);
    });
  });
});
