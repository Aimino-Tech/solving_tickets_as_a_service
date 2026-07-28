import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getSupabaseAdmin, getSupabaseAnon } from './supabase.js';

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

export class AuthService {
  async register(email: string, password: string, name?: string): Promise<AuthResult> {
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      user_metadata: name ? { name } : undefined,
    });
    if (error) throw new AuthError(error.message, 400);

    const user = data.user;
    return this.generateTokens(user.id, user.email!, name ?? null);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const { data: signInData, error: signInError } = await getSupabaseAnon().auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw new AuthError(signInError.message || 'Invalid email or password', 401);

    const supabaseUser = signInData.user;
    const name = supabaseUser.user_metadata?.name as string | undefined;

    return this.generateTokens(supabaseUser.id, supabaseUser.email!, name ?? null);
  }

  refreshToken(refreshToken: string): AuthResult | never {
    try {
      const decoded = jwt.verify(refreshToken, config.auth.jwtSecret) as { sub: string; email: string; iat?: number; exp?: number };
      return this.generateTokens(decoded.sub, decoded.email);
    } catch {
      throw new AuthError('Invalid or expired refresh token', 401);
    }
  }

  verifyToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret) as { sub: string; email: string; iat?: number; exp?: number };
      return { sub: decoded.sub, email: decoded.email };
    } catch {
      throw new AuthError('Invalid or expired token', 401);
    }
  }

  public generateTokens(userId: string, email: string, name: string | null = null): AuthResult {
    const payload = { sub: userId, email };

    const secret = config.auth.jwtSecret as string;
    const token = jwt.sign(payload, secret, { expiresIn: config.auth.jwtExpiresIn } as jwt.SignOptions);
    const refreshToken = jwt.sign(payload, secret, { expiresIn: config.auth.jwtRefreshExpiresIn } as jwt.SignOptions);

    return {
      token,
      refreshToken,
      user: { id: userId, email, name },
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
