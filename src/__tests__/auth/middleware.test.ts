import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockVerifyToken = vi.fn();
vi.mock('../../auth/service.js', () => ({
  authService: { verifyToken: mockVerifyToken },
}));

describe('auth/middleware', () => {
  let mod: typeof import('../../auth/middleware.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import('../../auth/middleware.js');
  });

  describe('requireAuth', () => {
    it('attaches user and calls next() when token is valid', () => {
      mockVerifyToken.mockReturnValue({ sub: '42', email: 'test@test.com' });
      const req = { headers: { authorization: 'Bearer valid.jwt.token' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.requireAuth(req, res, next);
      expect(mockVerifyToken).toHaveBeenCalledWith('valid.jwt.token');
      expect(req.user).toEqual({ id: '42', email: 'test@test.com' });
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is missing', () => {
      const req = { headers: {} } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is not Bearer', () => {
      const req = { headers: { authorization: 'Basic xyz' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Bearer token is empty', () => {
      mockVerifyToken.mockImplementation(() => { throw new Error('invalid token'); });
      const req = { headers: { authorization: 'Bearer ' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when verifyToken throws (expired token)', () => {
      mockVerifyToken.mockImplementation(() => { throw new Error('jwt expired'); });
      const req = { headers: { authorization: 'Bearer expired.jwt.token' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when verifyToken throws (forged signature)', () => {
      mockVerifyToken.mockImplementation(() => { throw new Error('invalid signature'); });
      const req = { headers: { authorization: 'Bearer forged.jwt.token' } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();
      mod.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('continues without user when Authorization header is missing', () => {
      const req = { headers: {} } as any;
      const res = {} as any;
      const next = vi.fn();
      mod.optionalAuth(req, res, next);
      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('attaches user when token is valid', () => {
      mockVerifyToken.mockReturnValue({ sub: '7', email: 'user@test.com' });
      const req = { headers: { authorization: 'Bearer valid.jwt.token' } } as any;
      const res = {} as any;
      const next = vi.fn();
      mod.optionalAuth(req, res, next);
      expect(req.user).toEqual({ id: '7', email: 'user@test.com' });
      expect(next).toHaveBeenCalled();
    });

    it('continues without user when token is invalid', () => {
      mockVerifyToken.mockImplementation(() => { throw new Error('invalid token'); });
      const req = { headers: { authorization: 'Bearer bad.jwt.token' } } as any;
      const res = {} as any;
      const next = vi.fn();
      mod.optionalAuth(req, res, next);
      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });
});
