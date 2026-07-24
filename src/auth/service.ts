import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { usersRepository } from '../db/repositories/UsersRepository.js';

export interface TokenPayload {
  sub: number;
  email: string;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  user: {
    id: number;
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
      const payload = jwt.verify(refreshToken, config.auth.jwtSecret) as TokenPayload;
      return this.generateTokens(payload.sub, payload.email);
    } catch {
      throw new AuthError('Invalid or expired refresh token', 401);
    }
  }

  verifyToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, config.auth.jwtSecret) as TokenPayload;
    } catch {
      throw new AuthError('Invalid or expired token', 401);
    }
  }

  private generateTokens(userId: number, email: string): AuthResult {
    const payload: TokenPayload = { sub: userId, email };

    const token = jwt.sign(payload, config.auth.jwtSecret, {
      expiresIn: config.auth.jwtExpiresIn,
    });

    const refreshToken = jwt.sign(payload, config.auth.jwtSecret, {
      expiresIn: config.auth.jwtRefreshExpiresIn,
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
