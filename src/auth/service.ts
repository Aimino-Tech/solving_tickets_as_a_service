import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getSupabaseAnon } from './supabase.js';
import { queryWithRetry } from '../db/connection.js';
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

const SALT_ROUNDS = 12;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  async register(email: string, password: string, name?: string): Promise<AuthResult> {
    const existing = await usersRepository.findByEmail(email);
    if (existing) {
      throw new AuthError('Email already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await usersRepository.create({ email, passwordHash, name });

    return this.generateTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const { data: signInData, error: signInError } = await getSupabaseAnon().auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw new AuthError(signInError.message || 'Invalid email or password', 401);

    const user = await usersRepository.findByEmail(email);
    if (!user) throw new AuthError('User not found', 404);

    return this.generateTokens(user.id, user.email);
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    let decoded: { sub: string; email: string };
    try {
      decoded = jwt.verify(refreshToken, config.auth.jwtSecret) as { sub: string; email: string; iat?: number; exp?: number };
    } catch {
      throw new AuthError('Invalid or expired refresh token', 401);
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await queryWithRetry<{
      id: string; user_id: string; token_hash: string; expires_at: string; revoked_at: string | null;
    }>(
      `SELECT id, user_id, token_hash, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );

    const row = stored.rows[0];
    if (!row) throw new AuthError('Refresh token not found', 401);
    if (row.revoked_at) throw new AuthError('Refresh token has been revoked', 401);
    if (new Date(row.expires_at) < new Date()) throw new AuthError('Refresh token expired', 401);

    await queryWithRetry(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.id]);

    return this.generateTokens(row.user_id, decoded.email);
  }

  verifyToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret) as { sub: string; email: string; iat?: number; exp?: number };
      return { sub: String(decoded.sub), email: decoded.email };
    } catch {
      throw new AuthError('Invalid or expired token', 401);
    }
  }

  public async generateTokens(userId: number | string, email: string): Promise<AuthResult> {
    const payload = { sub: userId, email };

    const secret = config.auth.jwtSecret as string;
    const token = jwt.sign(payload, secret, { expiresIn: config.auth.jwtExpiresIn } as jwt.SignOptions);

    const rawRefreshToken = jwt.sign({ ...payload, jti: crypto.randomUUID() }, secret, {
      expiresIn: config.auth.jwtRefreshExpiresIn,
    } as jwt.SignOptions);

    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + parseDurationMs(config.auth.jwtRefreshExpiresIn));

    await queryWithRetry(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [String(userId), tokenHash, expiresAt],
    );

    return {
      token,
      refreshToken: rawRefreshToken,
      user: { id: String(userId), email, name: null },
    };
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    const result = await queryWithRetry(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    if (result.rowCount === 0) throw new AuthError('Refresh token not found or already revoked', 404);
  }

  async revokeAllUserTokens(userId: string): Promise<number> {
    const result = await queryWithRetry(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

  async cleanupExpiredTokens(): Promise<number> {
    const result = await queryWithRetry(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() AND revoked_at IS NOT NULL`,
    );
    return result.rowCount ?? 0;
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

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}
