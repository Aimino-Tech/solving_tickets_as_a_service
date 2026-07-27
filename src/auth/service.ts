import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
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
    const user = await usersRepository.findByEmail(email);
    if (!user) {
      throw new AuthError('Invalid email or password', 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Invalid email or password', 401);
    }

    return this.generateTokens(user.id, user.email);
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

  public generateTokens(userId: string, email: string): AuthResult {
    const payload = { sub: userId, email };

    const secret = config.auth.jwtSecret as string;
    const token = jwt.sign(payload, secret, { expiresIn: config.auth.jwtExpiresIn } as jwt.SignOptions);
    const refreshToken = jwt.sign(payload, secret, { expiresIn: config.auth.jwtRefreshExpiresIn } as jwt.SignOptions);

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
