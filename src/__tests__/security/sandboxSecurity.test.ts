/**
 * Unit tests for src/security/sandboxSecurity.ts — Sandbox security configuration.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('security/sandboxSecurity', () => {
  let sandbox: typeof import('../../security/sandboxSecurity.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    sandbox = await import('../../security/sandboxSecurity.js');
  });

  describe('SANDBOX_SECURITY', () => {
    it('has privileged: false', () => {
      expect(sandbox.SANDBOX_SECURITY.privileged).toBe(false);
    });

    it('has readOnlyRootFS: true', () => {
      expect(sandbox.SANDBOX_SECURITY.readOnlyRootFS).toBe(true);
    });

    it('drops ALL capabilities', () => {
      expect(sandbox.SANDBOX_SECURITY.dropCapabilities).toContain('ALL');
    });

    it('has reasonable resource limits', () => {
      expect(sandbox.SANDBOX_SECURITY.resources.cpu.shares).toBe(512);
      expect(sandbox.SANDBOX_SECURITY.resources.memory.limit).toBe(512 * 1024 * 1024);
      expect(sandbox.SANDBOX_SECURITY.resources.disk.size).toBe(2 * 1024 * 1024 * 1024);
      expect(sandbox.SANDBOX_SECURITY.resources.pids.limit).toBe(256);
    });

    it('denies internal network ranges', () => {
      expect(sandbox.SANDBOX_SECURITY.network.deniedRanges).toContain('10.0.0.0/8');
      expect(sandbox.SANDBOX_SECURITY.network.deniedRanges).toContain('192.168.0.0/16');
    });
  });

  describe('validateSandboxConfig', () => {
    it('throws on privileged mode', () => {
      expect(() => sandbox.validateSandboxConfig({ privileged: true })).toThrow('privileged');
    });

    it('does not throw on safe configs', () => {
      expect(() => sandbox.validateSandboxConfig({})).not.toThrow();
    });
  });

  describe('SANDBOX_DOCKER_OPTS', () => {
    it('includes read-only and no-new-privileges flags', () => {
      expect(sandbox.SANDBOX_DOCKER_OPTS).toContain('--read-only');
      expect(sandbox.SANDBOX_DOCKER_OPTS).toContain('--security-opt=no-new-privileges:true');
    });

    it('includes memory and CPU limits', () => {
      expect(sandbox.SANDBOX_DOCKER_OPTS).toContain('--memory=512m');
      expect(sandbox.SANDBOX_DOCKER_OPTS).toContain('--cpus=0.5');
    });
  });

  describe('getDockerSecurityOpts', () => {
    it('returns default opts plus additional', () => {
      const opts = sandbox.getDockerSecurityOpts(['--extra=value']);
      expect(opts).toContain('--extra=value');
      expect(opts).toContain('--read-only');
    });
  });
});
