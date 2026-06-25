/**
 * JWT authentication middleware for premium dashboard API.
 *
 * Verifies Bearer tokens issued by the GitHub OAuth flow.
 * Attaches user info (githubId, username, avatar) to `req.user`.
 *
 * Environment:
 *   DASHBOARD_JWT_SECRET — HMAC secret for signing tokens (default: auto-generated)
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { rootLogger } from '../../../src/utils/logger.js';

const log = rootLogger.child({ module: 'premium-auth' });

// ---------------------------------------------------------------------------
// JWT helpers (lightweight, no library dependency)
// ---------------------------------------------------------------------------

const JWT_SECRET: string =
  process.env.DASHBOARD_JWT_SECRET ||
  (() => {
    const fallback = crypto.randomBytes(32).toString('hex');
    log.warn('DASHBOARD_JWT_SECRET not set - using ephemeral random key (sessions invalidate on restart)');
    return fallback;
  })();

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'stas-premium';
const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface JwtPayload {
  sub: string;
  username: string;
  avatar_url?: string;
  iat: number;
  exp: number;
  iss: string;
}

function b64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'>): string {
  const header = { alg: JWT_ALGORITHM, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
    iss: JWT_ISSUER,
  };

  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerB64}.${payloadB64}.${signature}`;
}

const invalidatedTokens = new Set<string>();

export function invalidateToken(token: string): void {
  const signature = token.split('.').pop();
  if (signature) {
    invalidatedTokens.add(signature);
    log.debug({ signature: signature.slice(0, 8) }, 'Token invalidated');
  }
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const signature = parts[2];
  if (invalidatedTokens.has(signature)) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (expectedSig.length !== signatureB64.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ signatureB64.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let payloadRaw: string;
  try {
    payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(payloadRaw) as JwtPayload;
  } catch {
    return null;
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (payload.iss !== JWT_ISSUER) return null;

  return payload;
}

export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  (req as Record<string, unknown>).user = {
    githubId: payload.sub,
    username: payload.username,
    avatarUrl: payload.avatar_url,
  };

  log.debug({ username: payload.username }, 'Authenticated request');
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    if (payload) {
      (req as Record<string, unknown>).user = {
        githubId: payload.sub,
        username: payload.username,
        avatarUrl: payload.avatar_url,
      };
    }
  }
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        githubId: string;
        username: string;
        avatarUrl?: string;
      };
    }
  }
}
