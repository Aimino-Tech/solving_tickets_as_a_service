import { describe, expect, it, vi, beforeEach } from 'vitest';

let jwtSign: ReturnType<typeof vi.fn>;
let jwtVerify: ReturnType<typeof vi.fn>;

vi.mock('jsonwebtoken', () => {
  jwtSign = vi.fn().mockReturnValue('access-token');
  jwtVerify = vi.fn();
  return {
    default: { sign: jwtSign, verify: jwtVerify },
  };
});

const mockCreateUser = vi.fn();
const mockSignInWithPassword = vi.fn();

vi.mock('../../auth/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      admin: {
        createUser: mockCreateUser,
      },
    },
  })),
  getSupabaseAnon: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  })),
}));

let AuthService: typeof import('../../auth/service.js').AuthService;
let AuthError: typeof import('../../auth/service.js').AuthError;
let service: import('../../auth/service.js').AuthService;

describe('AuthService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../auth/service.js');
    AuthService = mod.AuthService;
    AuthError = mod.AuthError;
    service = new AuthService();
  });

  describe('register()', () => {
    it('creates user and returns tokens on success', async () => {
      const fakeUser = { id: 'user-1', email: 'test@test.com', user_metadata: { name: 'Test' } };
      mockCreateUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
      jwtSign.mockReturnValue('access-token');
      const result = await service.register('test@test.com', 'ValidP@ss1', 'Test');

      expect(mockCreateUser).toHaveBeenCalledWith({
        email: 'test@test.com',
        password: 'ValidP@ss1',
        email_confirm: true,
        user_metadata: { name: 'Test', email_verified: true },
      });
      expect(result.token).toBe('access-token');
      expect(result.refreshToken).toBe('access-token');
      expect(result.user).toEqual({ id: 'user-1', email: 'test@test.com', emailVerified: true, name: 'Test' });
    });

    it('creates user without name and returns tokens', async () => {
      const fakeUser = { id: 'user-2', email: 'anon@test.com', user_metadata: {} };
      mockCreateUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
      jwtSign.mockReturnValue('access-token');

      const result = await service.register('anon@test.com', 'ValidP@ss1');

      expect(result.user.name).toBeNull();
    });

    it('throws 409 for duplicate email', async () => {
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already registered', code: 'email_exists' },
      });

      await expect(service.register('dup@test.com', 'ValidP@ss1')).rejects.toThrow(AuthError);
      await expect(service.register('dup@test.com', 'ValidP@ss1')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('throws 409 for duplicate email via message check', async () => {
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'A user with this email already registered', code: 'unknown' },
      });

      await expect(service.register('dup@test.com', 'ValidP@ss1')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('throws 400 for generic supabase error', async () => {
      mockCreateUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Password should be at least 6 characters', code: 'weak_password' },
      });

      await expect(service.register('test@test.com', 'weak')).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('login()', () => {
    it('returns tokens on successful login', async () => {
      const fakeUser = { id: 'user-1', email: 'test@test.com', user_metadata: { name: 'Test' } };
      mockSignInWithPassword.mockResolvedValue({ data: { user: fakeUser }, error: null });
      jwtSign.mockReturnValue('access-token');

      const result = await service.login('test@test.com', 'ValidP@ss1');

      expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'test@test.com', password: 'ValidP@ss1' });
      expect(result.user).toEqual({ id: 'user-1', email: 'test@test.com', emailVerified: false, name: 'Test' });
    });

    it('returns user with null name when no user_metadata name', async () => {
      const fakeUser = { id: 'user-2', email: 'noname@test.com', user_metadata: {} };
      mockSignInWithPassword.mockResolvedValue({ data: { user: fakeUser }, error: null });
      jwtSign.mockReturnValue('access-token');

      const result = await service.login('noname@test.com', 'ValidP@ss1');

      expect(result.user.name).toBeNull();
    });

    it('throws 401 for wrong password', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.login('test@test.com', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws 401 for nonexistent email', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.login('nonexist@test.com', 'AnyP@ss1')).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('refreshTokens()', () => {
    it('returns new tokens for valid refresh token', () => {
      jwtVerify.mockReturnValue({ sub: 'user-1', email: 'test@test.com' });
      jwtSign.mockReturnValue('new-access-token');

      const result = service.refreshToken('valid-refresh-token');

      expect(jwtVerify).toHaveBeenCalledWith('valid-refresh-token', expect.any(String));
      expect(result.token).toBe('new-access-token');
      expect(result.user.id).toBe('user-1');
    });

    it('throws 401 for expired refresh token', () => {
      jwtVerify.mockImplementation(() => { throw new Error('jwt expired'); });

      try {
        service.refreshToken('expired-token');
        expect.unreachable();
      } catch (e: any) {
        expect(e.statusCode).toBe(401);
        expect(e.message).toMatch(/Invalid or expired refresh token/);
      }
    });

    it('throws 401 for malformed refresh token', () => {
      jwtVerify.mockImplementation(() => { throw new Error('jwt malformed'); });

      try {
        service.refreshToken('bad-token');
        expect.unreachable();
      } catch (e: any) {
        expect(e.statusCode).toBe(401);
        expect(e.message).toMatch(/Invalid or expired refresh token/);
      }
    });
  });

  describe('verifyToken()', () => {
    it('returns payload for valid token', () => {
      jwtVerify.mockReturnValue({ sub: 'user-1', email: 'test@test.com' });

      const result = service.verifyToken('valid-token');

      expect(jwtVerify).toHaveBeenCalledWith('valid-token', expect.any(String));
      expect(result).toEqual({ sub: 'user-1', email: 'test@test.com' });
    });

    it('throws 401 for expired token', () => {
      jwtVerify.mockImplementation(() => { throw new Error('jwt expired'); });

      expect(() => service.verifyToken('expired-token')).toThrow(AuthError);
    });

    it('throws 401 for forged signature', () => {
      jwtVerify.mockImplementation(() => { throw new Error('invalid signature'); });

      expect(() => service.verifyToken('forged-token')).toThrow(AuthError);
    });

    it('throws 401 for malformed token', () => {
      jwtVerify.mockImplementation(() => { throw new Error('jwt malformed'); });

      expect(() => service.verifyToken('bad')).toThrow(AuthError);
    });
  });

  describe('generateTokens()', () => {
    it('returns access and refresh tokens with correct payload shape', () => {
      jwtSign.mockReturnValueOnce('access-token');
      jwtSign.mockReturnValueOnce('refresh-token');

      const result = service.generateTokens('user-1', 'test@test.com', 'Test');

      expect(jwtSign).toHaveBeenCalledTimes(2);
      expect(result.token).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).toEqual({ id: 'user-1', email: 'test@test.com', emailVerified: false, name: 'Test' });
    });

    it('uses correct JWT payload', () => {
      jwtSign.mockReturnValue('token');

      service.generateTokens('user-42', 'user@test.com');

      expect(jwtSign).toHaveBeenCalledWith(
        { sub: 'user-42', email: 'user@test.com' },
        expect.any(String),
        expect.objectContaining({ expiresIn: expect.any(String) }),
      );
    });

    it('returns user with null name when not provided', () => {
      jwtSign.mockReturnValue('token');

      const result = service.generateTokens('user-1', 'test@test.com');

      expect(result.user.name).toBeNull();
    });
  });
});
