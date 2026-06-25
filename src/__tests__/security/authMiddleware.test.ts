/**
 * Unit tests for src/security/authMiddleware.ts — JWT auth middleware.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({ config: {} }));

describe('security/authMiddleware', () => {
  let auth: typeof import('../../security/authMiddleware.js');

  beforeEach(async () => {
    auth = await import('../../security/authMiddleware.js');
  });

  describe('requireAuth', () => {
    it('returns 401 when no token provided', () => {
      const req = { headers: {} } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is malformed', () => {
      const req = { headers: { authorization: 'Bearer not-a-jwt' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when token is expired', () => {
      // Create an expired JWT
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ sub: '1', githubUsername: 'test', tier: 'free', exp: Math.floor(Date.now() / 1000) - 3600 }));
      const token = `${header}.${payload}.signature`;
      const req = { headers: { authorization: `Bearer ${token}` } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('calls next() when token is valid', () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ sub: '1', githubUsername: 'test', tier: 'free', exp: Math.floor(Date.now() / 1000) + 3600 }));
      const token = `${header}.${payload}.signature`;
      const req = { headers: { authorization: `Bearer ${token}` } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe(1);
      expect(req.user!.githubUsername).toBe('test');
    });
  });
});
