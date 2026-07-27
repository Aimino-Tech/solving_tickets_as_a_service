import jwt from 'jsonwebtoken';
import { getSupabaseAdmin, getSupabaseAnon, supabaseJwtSecret } from './supabase.js';
import { usersRepository } from '../db/repositories/UsersRepository.js';
import type { User } from '../db/types/users.js';

export interface TokenPayload {
  sub: string;
  email: string;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '30d';

export class AuthService {
  async register(email: string, password: string, name?: string): Promise<AuthResult> {
    const { data: createData, error: createError } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || '' },
    });
    if (createError) throw new AuthError(createError.message, createError.status || 400);

    const supabaseUid = createData.user!.id;

    const existingLocal = await usersRepository.findByEmail(email).catch(() => undefined);
    let user: User;
    if (existingLocal) {
      user = (await usersRepository.update(existingLocal.id, { name })) ?? existingLocal;
    } else {
      user = await usersRepository.create({
        id: supabaseUid,
        email,
        passwordHash: '',
        name,
      });
    }

    return this.generateTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const { data: signInData, error: signInError } = await getSupabaseAnon().auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw new AuthError(signInError.message, 401);

    const user = await usersRepository.findByEmail(email);
    if (!user) throw new AuthError('User not found', 404);

    return this.generateTokens(user.id, user.email);
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const payload = jwt.verify(refreshToken, supabaseJwtSecret) as TokenPayload;
      return this.generateTokens(payload.sub, payload.email);
    } catch {
      throw new AuthError('Invalid or expired refresh token', 401);
    }
  }

  verifyToken(token: string): TokenPayload {
    if (!supabaseJwtSecret) {
      throw new AuthError('Supabase JWT secret not configured', 500);
    }
    try {
      const payload = jwt.verify(token, supabaseJwtSecret) as jwt.JwtPayload & { email?: string };
      if (!payload.sub || !payload.email) {
        throw new AuthError('Invalid token payload', 401);
      }
      return { sub: String(payload.sub), email: payload.email };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Invalid or expired token', 401);
    }
  }

  generateTokens(userId: string, email: string): AuthResult {
    const payload: TokenPayload = { sub: userId, email };

    const token = jwt.sign(payload, supabaseJwtSecret, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    const refreshToken = jwt.sign(payload, supabaseJwtSecret, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    });

    return {
      token,
      refreshToken,
      user: { id: userId, email, name: null },
    };
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const authService = new AuthService();
