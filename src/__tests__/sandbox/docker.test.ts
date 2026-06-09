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
      image: 'node:22-alpine',
      sandboxTimeoutMs: 120_000,
      networkRestrict: false,
      allowedHosts: [],
      containerMemory: '2g',
      containerCpu: 1,
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue(mockLogger),
  },
}));

vi.mock('dockerode', () => {
  const mockContainer = {
    id: 'mock-container-id',
    start: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn(),
    exec: vi.fn(),
  };
  const mockDocker = vi.fn(() => ({
    version: vi.fn().mockResolvedValue({ Version: '24.0.0' }),
    pull: vi.fn().mockResolvedValue(undefined),
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getContainer: vi.fn().mockReturnValue(mockContainer),
    modem: {
      demuxStream: vi.fn(),
      followProgress: vi.fn((_stream, cb) => cb(null)),
    },
  }));
  return { default: mockDocker };
});

import { DockerSandbox } from '../../sandbox/docker.js';

const CONTAINER_WORKDIR = '/home/node';

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

  describe('buildCreateOpts()', () => {
    it('sets the working directory to CONTAINER_WORKDIR', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.WorkingDir).toBe(CONTAINER_WORKDIR);
    });

    it('has a volume mount for CONTAINER_WORKDIR', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.Binds).toBeDefined();
      const workdirBind = (opts.HostConfig.Binds as string[]).find(
        (b: string) => b.endsWith(`:${CONTAINER_WORKDIR}`),
      );
      expect(workdirBind).toBeDefined();
    });

    it('keeps the /tmp tmpfs mount', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.Tmpfs).toBeDefined();
      expect((opts.HostConfig.Tmpfs as Record<string, string>)['/tmp']).toBeDefined();
    });

    it('does not have a tmpfs mount for CONTAINER_WORKDIR', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      const tmpfs = opts.HostConfig.Tmpfs as Record<string, string> | undefined;
      if (tmpfs) {
        expect(Object.keys(tmpfs)).not.toContain(CONTAINER_WORKDIR);
      }
    });

    it('includes hardened resource limits', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.PidsLimit).toBe(256);
      expect(opts.HostConfig.Ulimits).toHaveLength(2);
      expect(opts.HostConfig.Ulimits[0].Name).toBe('nofile');
      expect(opts.HostConfig.Ulimits[0].Soft).toBe(1024);
      expect(opts.HostConfig.Ulimits[0].Hard).toBe(1024);
      expect(opts.HostConfig.Ulimits[1].Name).toBe('nproc');
      expect(opts.HostConfig.Ulimits[1].Soft).toBe(512);
      expect(opts.HostConfig.Ulimits[1].Hard).toBe(512);
    });

    it('runs as non-root user', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.User).toBe('1000:1000');
    });

    it('sets stop timeout to 5s', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.StopTimeout).toBe(5);
    });

    it('drops ALL capabilities', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.CapDrop).toContain('ALL');
    });

    it('does not add NET_ADMIN or NET_RAW capabilities', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      const capAdd = opts.HostConfig.CapAdd;
      expect(capAdd).toBeUndefined();
    });

    it('includes Init for proper PID 1 handling', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.Init).toBe(true);
    });

    it('includes security-opt no-new-privileges', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
    });

    it('uses memory limit from config', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.Memory).toBeGreaterThan(0);
    });

    it('uses cpu limit from config', () => {
      const sandbox = createDockerSandbox();
      const opts = (sandbox as any).buildCreateOpts('node:22-alpine', 'test-container');

      expect(opts.HostConfig.NanoCpus).toBe(1 * 1e9);
    });
  });
});
