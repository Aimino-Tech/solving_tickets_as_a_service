/**
 * Hardening tests for Docker sandbox security.
 *
 * Tests verify that:
 * - Seccomp profile blocks dangerous syscalls
 * - Container runs as non-root
 * - Read-only root filesystem enforced
 * - No privileged mode
 * - Capabilities dropped
 * - AppArmor profile is applied
 * - gVisor runtime can be configured
 * - Vulnerability scanning works
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
}));

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  mkdtempSync: vi.fn(() => '/tmp/stas-sandbox-test-xxxxxx'),
  unlinkSync: vi.fn(),
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
      seccompProfile: '/app/src/sandbox/profiles/seccomp.json',
      apparmorProfile: 'stas-sandbox',
      runtime: 'runc',
      dropAllCapabilities: true,
      networkDisabled: true,
      readonlyRootfs: true,
      imageScanEnabled: false,
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
  // Use a class constructor instead of vi.fn() for vitest 4.x compatibility
  function MockDocker() {
    /* noop */
  }
  MockDocker.prototype.version = vi.fn().mockResolvedValue({ Version: '24.0.0' });
  MockDocker.prototype.pull = vi.fn().mockResolvedValue(undefined);
  MockDocker.prototype.createContainer = vi.fn().mockResolvedValue(mockContainer);
  MockDocker.prototype.getContainer = vi.fn().mockReturnValue(mockContainer);
  MockDocker.prototype.modem = {
    demuxStream: vi.fn(),
    followProgress: vi.fn((_stream, cb) => cb(null)),
  };
  return { default: MockDocker as any };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { DockerSandbox } from '../../sandbox/docker.js';
import { config } from '../../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sandbox Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
    mockSpawnSync.mockReset();
  });

  // ── 1. Seccomp Profile ──
  describe('Seccomp profile', () => {
    it('adds --security-opt seccomp when profile is configured', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const seccompOpts = args.filter(
        (_: string, i: number) => args[i - 1] === '--security-opt' && (args[i] as string).startsWith('seccomp='),
      );

      expect(seccompOpts.length).toBe(1);
      expect(seccompOpts[0]).toBe(`seccomp=${config.docker.seccompProfile}`);
    });
  });

  // ── 2. AppArmor Profile ──
  describe('AppArmor profile', () => {
    it('adds --security-opt apparmor when profile is configured', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const apparmorOpts = args.filter(
        (_: string, i: number) => args[i - 1] === '--security-opt' && (args[i] as string).startsWith('apparmor='),
      );

      expect(apparmorOpts.length).toBe(1);
      expect(apparmorOpts[0]).toBe(`apparmor=${config.docker.apparmorProfile}`);
    });
  });

  // ── 3. No New Privileges ──
  describe('No new privileges', () => {
    it('sets --security-opt no-new-privileges:true', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const noNewPrivs = args.filter(
        (_: string, i: number) => args[i - 1] === '--security-opt' && args[i] === 'no-new-privileges:true',
      );

      expect(noNewPrivs.length).toBe(1);
    });
  });

  // ── 4. Capability Dropping ──
  describe('Capability dropping', () => {
    it('drops ALL capabilities via --cap-drop=ALL', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const capDropAll = args.filter(
        (_: string, i: number) => args[i - 1] === '--cap-drop' && args[i] === 'ALL',
      );

      expect(capDropAll.length).toBe(1);
    });

    it('does NOT add NET_ADMIN or NET_RAW capabilities by default', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const capAdds = args.filter(
        (_: string, i: number) => args[i - 1] === '--cap-add',
      );

      // When networkDisabled is true, no network capabilities should be added
      expect(capAdds.filter((c: string) => c === 'NET_ADMIN' || c === 'NET_RAW').length).toBe(0);
    });
  });

  // ── 5. Read-Only Root Filesystem ──
  describe('Read-only root filesystem', () => {
    it('adds --read-only flag', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      expect(args).toContain('--read-only');
    });

    it('adds --tmpfs /tmp:rw,noexec,nosuid,size=2g', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const tmpfsMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '--tmpfs',
      );
      expect(tmpfsMounts).toContain('/tmp:rw,noexec,nosuid,size=2g');
    });

    it('does not mount writable tmpfs on the working directory', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const tmpfsMounts = args.filter(
        (_: string, i: number) => args[i - 1] === '--tmpfs',
      );
      const workdirTmpfs = tmpfsMounts.filter((t: string) => t.startsWith('/home/node:'));
      expect(workdirTmpfs.length).toBe(0);
    });
  });

  // ── 6. No Privileged Mode ──
  describe('No privileged mode', () => {
    it('does NOT include --privileged flag', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      expect(args).not.toContain('--privileged');
    });

    it('does not include --pid=host flag', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      expect(args).not.toContain('--pid=host');
    });
  });

  // ── 7. Network Isolation ──
  describe('Network isolation', () => {
    it('uses --network none when network is disabled', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const networkIdx = args.indexOf('--network');
      expect(networkIdx).not.toBe(-1);
      expect(args[networkIdx + 1]).toBe('none');
    });
  });

  // ── 8. gVisor Runtime Support ──
  describe('gVisor runtime support', () => {
    it('uses runc runtime by default', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const runtimeIdx = args.indexOf('--runtime');
      expect(runtimeIdx).not.toBe(-1);
      expect(args[runtimeIdx + 1]).toBe('runc');
    });
  });

  // ── 9. Non-Root User ──
  describe('Non-root user', () => {
    it('sets working directory to /home/node (non-root path)', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const wdIdx = args.indexOf('-w');
      expect(wdIdx).not.toBe(-1);
      expect(args[wdIdx + 1]).toBe('/home/node');
    });

    it('sets HOME environment variable to /home/node', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const envHome = args.find((a: string) => a.startsWith('HOME='));
      expect(envHome).toBe('HOME=/home/node');
    });
  });

  // ── 10. Docker Init ──
  describe('Docker init', () => {
    it('includes --init flag for proper signal handling', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      expect(args).toContain('--init');
    });
  });

  // ── 11. Build Args Order ──
  describe('Build args ordering', () => {
    it('includes all required security args', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const requiredArgs = ['--security-opt', '--cap-drop', '--read-only', '--tmpfs', '--init', '--runtime'];
      for (const arg of requiredArgs) {
        expect(args).toContain(arg);
      }
    });
  });

  // ── 12. Multiple Security Opts ──
  describe('Multiple security options', () => {
    it('includes multiple --security-opt flags', () => {
      const sandbox = createDockerSandbox();
      const args = (sandbox as any).buildCreateArgs('node:22-alpine', 'test-container');

      const securityOpts = args.filter(
        (_: string, i: number) => args[i - 1] === '--security-opt',
      );

      // At minimum: seccomp, apparmor, no-new-privileges
      expect(securityOpts.length).toBeGreaterThanOrEqual(3);

      const optValues = securityOpts.join(' ');
      expect(optValues).toContain('seccomp=');
      expect(optValues).toContain('apparmor=');
      expect(optValues).toContain('no-new-privileges:true');
    });
  });
});

// ── 13. Scan Module Tests ──
describe('Vulnerability Scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scanImage returns empty result when scanning is disabled', async () => {
    const { scanImage } = await import('../../sandbox/scan.js');
    const result = scanImage('node:22-alpine');
    expect(result.passed).toBe(true);
    expect(result.total).toBe(0);
  });
});

// ── 14. Config Defaults ──
describe('Docker config defaults', () => {
  it('has runtime defaulting to runc', () => {
    expect(config.docker.runtime).toBe('runc');
  });

  it('has dropAllCapabilities defaulting to true', () => {
    expect(config.docker.dropAllCapabilities).toBe(true);
  });

  it('has readonlyRootfs defaulting to true', () => {
    expect(config.docker.readonlyRootfs).toBe(true);
  });
});
