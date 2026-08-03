import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { getSupabaseAdmin, getSupabaseAnon } from './supabase.js';

const log = rootLogger.child({ module: 'auth-service' });

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
    emailVerified: boolean;
    name: string | null;
  };
  verificationToken?: string;
}

const VERIFICATION_TOKEN_EXPIRY = '24h';

export class AuthService {
  async register(email: string, password: string, name?: string): Promise<AuthResult> {
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { ...(name ? { name } : {}), email_verified: true },
    });
    if (error) {
      const status =
        error.code === 'email_exists' ||
        error.message?.toLowerCase().includes('already registered') ||
        error.message?.toLowerCase().includes('duplicate')
          ? 409
          : 400;
      throw new AuthError(error.message, status);
    }

    const user = data.user;
    const verificationToken = this.generateVerificationToken(user.id, user.email!);

    log.info(
      { userId: user.id, email: user.email, verificationToken },
      'User registered — email verification required',
    );

    const tokens = this.generateTokens(user.id, user.email!, name ?? null);
    return { ...tokens, user: { ...tokens.user, emailVerified: true }, verificationToken };
  }

  generateVerificationToken(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email, purpose: 'email_verify' }, config.auth.jwtSecret as string, {
      expiresIn: VERIFICATION_TOKEN_EXPIRY,
    });
  }

  async verifyEmail(token: string): Promise<{ email: string }> {
    let payload: { sub: string; email: string; purpose?: string };
    try {
      payload = jwt.verify(token, config.auth.jwtSecret as string) as { sub: string; email: string; purpose?: string };
      if (payload.purpose !== 'email_verify') {
        throw new AuthError('Invalid verification token', 400);
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Invalid or expired verification token', 400);
    }

    const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(payload.sub);
    if (error || !data.user) {
      throw new AuthError('User not found', 404);
    }

    if (data.user.email_confirmed_at) {
      throw new AuthError('Email already verified', 400);
    }

    const { error: updateError } = await getSupabaseAdmin().auth.admin.updateUserById(payload.sub, {
      email_confirm: true,
      user_metadata: { ...data.user.user_metadata, email_verified: true },
    });
    if (updateError) {
      throw new AuthError('Failed to verify email', 500);
    }

    log.info({ userId: payload.sub, email: payload.email }, 'Email verified');
    return { email: payload.email };
  }

  async resendVerification(email: string): Promise<{ verificationToken: string }> {
    const {
      data: { users },
      error: listError,
    } = await getSupabaseAdmin().auth.admin.listUsers();
    if (listError) {
      throw new AuthError('Failed to find user', 500);
    }

    const user = users.find((u) => u.email === email);
    if (!user) {
      throw new AuthError('User not found', 404);
    }

    if (user.email_confirmed_at) {
      throw new AuthError('Email already verified', 400);
    }

    const verificationToken = this.generateVerificationToken(user.id, user.email!);

    log.info({ userId: user.id, email }, 'Resent verification email');

    return { verificationToken };
  }

  generateMagicLinkToken(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email, purpose: 'magic_link' }, config.auth.jwtSecret as string, {
      expiresIn: '15m',
    });
  }

  async issueMagicLink(email: string): Promise<string | null> {
    try {
      const {
        data: { users },
        error: listError,
      } = await getSupabaseAdmin().auth.admin.listUsers();
      if (listError || !users) return null;
      const user = users.find((u) => u.email === email);
      if (!user) return null;

      const token = this.generateMagicLinkToken(user.id, user.email!);
      log.info(
        { userId: user.id, email, magicLinkUrl: `/auth/magic-link?token=${token}` },
        'Magic link issued — log-in based delivery (no email provider configured)',
      );
      return token;
    } catch (err) {
      log.error({ err }, 'Failed to issue magic link');
      return null;
    }
  }

  verifyMagicLinkToken(token: string): { sub: string; email: string } {
    let payload: { sub: string; email: string; purpose?: string };
    try {
      payload = jwt.verify(token, config.auth.jwtSecret as string) as { sub: string; email: string; purpose?: string };
      if (payload.purpose !== 'magic_link') {
        throw new AuthError('Invalid magic link', 400);
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Invalid or expired magic link', 401);
    }
    return { sub: payload.sub, email: payload.email };
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
      const decoded = jwt.verify(refreshToken, config.auth.jwtSecret) as {
        sub: string;
        email: string;
        iat?: number;
        exp?: number;
      };
      return this.generateTokens(decoded.sub, decoded.email);
    } catch {
      throw new AuthError('Invalid or expired refresh token', 401);
    }
  }

  verifyToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret) as {
        sub: string;
        email: string;
        iat?: number;
        exp?: number;
      };
      return { sub: decoded.sub, email: decoded.email };
    } catch {
      throw new AuthError('Invalid or expired token', 401);
    }
  }

  async createPasswordResetToken(email: string): Promise<void> {
    try {
      const {
        data: { users },
        error: listError,
      } = await getSupabaseAdmin().auth.admin.listUsers();
      if (listError || !users) return;
      const user = users.find((u) => u.email === email);
      if (!user) return;

      const resetToken = jwt.sign(
        { sub: user.id, email: user.email, purpose: 'password_reset' },
        config.auth.jwtSecret as string,
        { expiresIn: '15m' },
      );

      log.info({ userId: user.id, email, resetToken }, 'Password reset token generated');
    } catch (err) {
      log.error({ err }, 'Failed to create password reset token');
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new AuthError('Password must be at least 8 characters', 400);
    }

    let payload: { sub: string; email: string; purpose?: string };
    try {
      payload = jwt.verify(token, config.auth.jwtSecret as string) as { sub: string; email: string; purpose?: string };
      if (payload.purpose !== 'password_reset') {
        throw new AuthError('Invalid reset token', 400);
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Invalid or expired reset token', 400);
    }

    const { error: updateError } = await getSupabaseAdmin().auth.admin.updateUserById(payload.sub, {
      password: newPassword,
    });
    if (updateError) {
      throw new AuthError('Failed to reset password', 500);
    }

    log.info({ userId: payload.sub, email: payload.email }, 'Password reset successful');
  }

  public generateTokens(userId: string, email: string, name: string | null = null): AuthResult {
    const payload = { sub: userId, email };

    const secret = config.auth.jwtSecret as string;
    const token = jwt.sign(payload, secret, { expiresIn: config.auth.jwtExpiresIn } as jwt.SignOptions);
    const refreshToken = jwt.sign(payload, secret, { expiresIn: config.auth.jwtRefreshExpiresIn } as jwt.SignOptions);

    return {
      token,
      refreshToken,
      user: { id: userId, email, emailVerified: false, name },
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
