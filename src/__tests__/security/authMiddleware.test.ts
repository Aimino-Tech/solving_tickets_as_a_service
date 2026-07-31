import { describe, expect, it, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-secret-at-least-32-characters-long!!';

vi.mock('../../config.js', () => ({
  config: {
    auth: {
      jwtSecret: TEST_SECRET,
      jwtExpiresIn: '15m',
      jwtRefreshExpiresIn: '7d',
    },
  },
}));

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
      const token = jwt.sign({ sub: '1', email: 'test@test.com' }, TEST_SECRET, { expiresIn: '0s' });
      const req = { headers: { authorization: `Bearer ${token}` } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when token has forged signature', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: '1', email: 'test@test.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const forgedToken = `${header}.${payload}.forgedsignature`;
      const req = { headers: { authorization: `Bearer ${forgedToken}` } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when token is signed with wrong secret', () => {
      const token = jwt.sign({ sub: '1', email: 'test@test.com' }, 'wrong-secret');
      const req = { headers: { authorization: `Bearer ${token}` } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('calls next() when token is valid', () => {
      const token = jwt.sign({ sub: '1', email: 'test@test.com' }, TEST_SECRET, { expiresIn: '1h' });
      const req = { headers: { authorization: `Bearer ${token}` } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      auth.requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe('1');
      expect(req.user!.email).toBe('test@test.com');
    });
  });
});
