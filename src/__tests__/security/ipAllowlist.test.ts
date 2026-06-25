/**
 * Unit tests for src/security/ipAllowlist.ts — IP allowlist middleware.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  security: { ipAllowlist: { enabled: false, ips: [] as string[] } },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('security/ipAllowlist', () => {
  let ipAllowlist: typeof import('../../security/ipAllowlist.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConfig.security.ipAllowlist = { enabled: false, ips: [] };
    vi.resetModules();
    ipAllowlist = await import('../../security/ipAllowlist.js');
  });

  describe('ipAllowlistMiddleware', () => {
    it('passes through when allowlist is disabled', () => {
      const req = { headers: {}, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      ipAllowlist.ipAllowlistMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects when enabled with empty allowlist and non-localhost', async () => {
      mockConfig.security.ipAllowlist = { enabled: true, ips: [] };
      const mod = await import('../../security/ipAllowlist.js');

      const req = { headers: {}, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' }, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.ipAllowlistMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows localhost when enabled with empty allowlist', async () => {
      mockConfig.security.ipAllowlist = { enabled: true, ips: [] };
      const mod = await import('../../security/ipAllowlist.js');

      const req = { headers: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.ipAllowlistMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows IPs in the allowlist', async () => {
      mockConfig.security.ipAllowlist = { enabled: true, ips: ['203.0.113.1'] };
      const mod = await import('../../security/ipAllowlist.js');

      const req = { headers: {}, ip: '203.0.113.1', socket: { remoteAddress: '203.0.113.1' }, path: '/test' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.ipAllowlistMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
