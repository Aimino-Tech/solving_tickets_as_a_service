import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
  child: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  config: {
    docker: {
      image: 'ubuntu:22.04',
      sandboxTimeoutMs: 120_000,
      networkRestrict: false,
      allowedHosts: [],
      containerMemory: '2g',
      containerCpu: 2,
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue(mockLogger),
  },
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { DockerSandbox } from '../../sandbox/docker.js';

const CONTAINER_WORKDIR = '/home/user';

function createDockerSandbox(): DockerSandbox {
  const getToken = vi.fn<(installationId: number) => Promise<string>>().mockResolvedValue('mock-token');
  const sandbox = new DockerSandbox(
    'https://github.com/owner/repo.git',
    'owner',
    'repo',
    123,
    getToken,
  );
  (sandbox as any).tempDir = '/tmp/stas-sandbox-test';
  return sandbox;
}

describe('DockerSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  describe('buildCreateArgs()', () => {
    it('produces no duplicate mount targets for the same path', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('ubuntu:22.04', 'test-container');

      const volumeMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '-v',
      );
      const tmpfsMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '--tmpfs',
      );

      const volumePaths = volumeMounts.map((v: string) => v.split(':')[1]);
      const tmpfsPaths = tmpfsMounts.map((t: string) => t.split(':')[0]);

      for (const path of volumePaths) {
        expect(tmpfsPaths).not.toContain(path);
      }

      expect(volumePaths).toContain(CONTAINER_WORKDIR);
    });

    it('has a volume mount for CONTAINER_WORKDIR', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('ubuntu:22.04', 'test-container');

      const volumeMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '-v',
      );
      const workdirVolumes = volumeMounts.filter((v: string) =>
        v.endsWith(`:${CONTAINER_WORKDIR}`),
      );
      expect(workdirVolumes.length).toBe(1);
    });

    it('does not have a tmpfs mount for CONTAINER_WORKDIR', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('ubuntu:22.04', 'test-container');

      const tmpfsMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '--tmpfs',
      );
      const workdirTmpfs = tmpfsMounts.filter((t: string) =>
        t.startsWith(`${CONTAINER_WORKDIR}:`),
      );
      expect(workdirTmpfs.length).toBe(0);
    });

    it('keeps the /tmp tmpfs mount', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('ubuntu:22.04', 'test-container');

      const tmpfsMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '--tmpfs',
      );
      const tmpTmpfs = tmpfsMounts.filter((t: string) =>
        t.startsWith('/tmp:'),
      );
      expect(tmpTmpfs.length).toBe(1);
    });

    it('sets the working directory to CONTAINER_WORKDIR', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('ubuntu:22.04', 'test-container');

      const wdIndex = args.indexOf('-w');
      expect(wdIndex).not.toBe(-1);
      expect(args[wdIndex + 1]).toBe(CONTAINER_WORKDIR);
    });
  });
});
