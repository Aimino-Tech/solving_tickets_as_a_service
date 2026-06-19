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

vi.mock('../../config.js', () => ({
  config: {
    docker: {
      image: 'ubuntu:22.04',
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue(mockLogger),
  },
}));

import { SandboxGC } from '../../sandbox/gc.js';

function queueDockerCalls(calls: Array<{ stdout: string; stderr?: string; status?: number }>) {
  const def = { stdout: '', stderr: '', status: 0, pid: 1, output: ['', ''], signal: null };
  for (const c of calls) {
    mockSpawnSync.mockReturnValueOnce({
      stdout: c.stdout,
      stderr: c.stderr ?? '',
      status: c.status ?? 0,
      pid: 1,
      output: [c.stdout, c.stderr ?? ''],
      signal: null,
    });
  }
  mockSpawnSync.mockReturnValue(def);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

describe('SandboxGC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
    mockSpawnSync.mockReset();
  });

  describe('sweep', () => {
    it('cleans containers older than 1 hour', async () => {
      const oldContainerTime = hoursAgo(2).toISOString();
      queueDockerCalls([
        { stdout: `container-old\t${oldContainerTime}\tstas-sandbox-old` },
        { stdout: '' },
        { stdout: '' },
        { stdout: '', status: 1 },
      ]);

      const gc = new SandboxGC();
      const cleaned = await gc.sweep();

      expect(cleaned).toBe(1);
    });

    it('skips containers younger than 1 hour', async () => {
      const recentContainerTime = hoursAgo(0.5).toISOString();
      queueDockerCalls([
        { stdout: `container-recent\t${recentContainerTime}\tstas-sandbox-recent` },
        { stdout: '', status: 1 },
      ]);

      const gc = new SandboxGC();
      const cleaned = await gc.sweep();

      expect(cleaned).toBe(0);
    });

    it('handles empty container list gracefully', async () => {
      queueDockerCalls([
        { stdout: '' },
        { stdout: '', status: 1 },
      ]);

      const gc = new SandboxGC();
      const cleaned = await gc.sweep();

      expect(cleaned).toBe(0);
    });

    it('returns 0 when docker ps fails', async () => {
      queueDockerCalls([
        { stdout: '', status: 1 },
      ]);

      const gc = new SandboxGC();
      const cleaned = await gc.sweep();

      expect(cleaned).toBe(0);
    });

    it('uses stas-sandbox=true filter in docker ps', async () => {
      queueDockerCalls([
        { stdout: '' },
        { stdout: '', status: 1 },
      ]);

      const gc = new SandboxGC();
      await gc.sweep();

      const psCall = mockSpawnSync.mock.calls.find(
        (call: any[]) =>
          call[0] === 'docker' &&
          Array.isArray(call[1]) && call[1].includes('ps'),
      );
      expect(psCall).toBeDefined();
      const args: string[] = psCall![1];
      expect(args.join(' ')).toContain('label=stas-sandbox=true');
    });

    it('returns count of multiple cleaned containers', async () => {
      const oldTime = hoursAgo(5).toISOString();
      queueDockerCalls([
        { stdout: `c1\t${oldTime}\tsandbox-1\nc2\t${oldTime}\tsandbox-2\nc3\t${oldTime}\tsandbox-3` },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '' },
        { stdout: '', status: 1 },
      ]);

      const gc = new SandboxGC();
      const cleaned = await gc.sweep();

      expect(cleaned).toBe(3);
    });
  });
});
