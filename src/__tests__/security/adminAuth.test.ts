/**
 * Unit tests for src/security/adminAuth.ts — Admin endpoint authentication middleware.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockAdminConfig = { security: { adminApiKey: 'test-admin-key' } };

vi.mock('../../config.js', () => ({
  config: mockAdminConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('security/adminAuth', () => {
  let adminAuth: typeof import('../../security/adminAuth.js');

  beforeEach(async () => {
    mockAdminConfig.security.adminApiKey = 'test-admin-key';
    adminAuth = await import('../../security/adminAuth.js');
  });

  describe('adminAuthMiddleware', () => {
    it('returns 500 when ADMIN_API_KEY is not configured', async () => {
      mockAdminConfig.security.adminApiKey = '';
      vi.resetModules();
      const mod = await import('../../security/adminAuth.js');

      const req = { headers: {}, ip: '127.0.0.1', path: '/admin' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.adminAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when no key is provided', () => {
      const req = { headers: {}, ip: '127.0.0.1', path: '/admin' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      adminAuth.adminAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when wrong key is provided', () => {
      const req = { headers: { authorization: 'Bearer wrong-key' }, ip: '127.0.0.1', path: '/admin' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      adminAuth.adminAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when valid key provided via Authorization Bearer', () => {
      const req = { headers: { authorization: 'Bearer test-admin-key' }, ip: '127.0.0.1', path: '/admin' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      adminAuth.adminAuthMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('calls next() when valid key provided via x-admin-key header', () => {
      const req = { headers: { 'x-admin-key': 'test-admin-key' }, ip: '127.0.0.1', path: '/admin' } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      adminAuth.adminAuthMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
