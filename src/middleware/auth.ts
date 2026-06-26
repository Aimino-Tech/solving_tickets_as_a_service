/**
 * Auth middleware — API key + JWT authentication.
 *
 * Provides three tiers of auth:
 *   1. **API key** (`requireApiKey`) — checks `X-API-Key` header against
 *      configured admin/MCP API keys.
 *   2. **JWT session** (`requireSession`) — validates a JWT from the
 *      `stas_token` cookie or `Authorization: Bearer` header (existing
 *      dashboard OAuth flow).
 *   3. **Combined** (`requireAuth`) — tries API key first, falls back to JWT.
 *      Use this for routes that accept either auth method.
 *
 * Also exports `optionalSession` and `optionalAuth` variants that attach the
 * user if valid but do NOT reject unauthenticated requests.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'auth-middleware' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  /** GitHub user database ID (JWT) or 0 for API-key-authed requests. */
  id: number;

  /** GitHub login (username) or 'api-key' for API-key-authed requests. */
  login: string;

  /** Avatar URL from GitHub (null for API key). */
  avatarUrl: string | null;

  /** Auth method used. */
  method: 'api-key' | 'session';
}

export interface SessionPayload {
  sub: number;
  login: string;
  avatarUrl: string | null;
  iat: number;
  exp: number;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      /** Populated by `requireSession`, `optionalSession`, `requireAuth`,
       *  or `optionalAuth`. */
      sessionUser?: AuthUser;
    }
  }
}

// ---------------------------------------------------------------------------
// API key auth
// ---------------------------------------------------------------------------

/** Well-known header for API key authentication. */
export const API_KEY_HEADER = 'x-api-key';

/**
 * Collect all configured API keys that should be accepted.
 * Checks ADMIN_API_KEY and MCP_API_KEY config values.
 */
function getValidApiKeys(): string[] {
  const keys: string[] = [];
  if (config.admin.apiKey) keys.push(config.admin.apiKey);
  if (config.mcp.apiKey) keys.push(config.mcp.apiKey);
  return keys;
}

/**
 * Express middleware — requires a valid API key via the `X-API-Key` header.
 *
 * Matches against configured `ADMIN_API_KEY` and `MCP_API_KEY` env vars.
 * Returns 401 if the key is missing or invalid.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers[API_KEY_HEADER];

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(401).json({ error: 'API key required via X-API-Key header' });
    return;
  }

  const validKeys = getValidApiKeys();
  if (validKeys.length === 0) {
    log.warn('No API keys configured — requireApiKey will reject all requests');
    res.status(401).json({ error: 'API key authentication is not configured' });
    return;
  }

  if (!validKeys.includes(apiKey)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  req.sessionUser = {
    id: 0,
    login: 'api-key',
    avatarUrl: null,
    method: 'api-key',
  };
  next();
}

// ---------------------------------------------------------------------------
// JWT session helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = config.github.oauthClientSecret || 'stas-dev-jwt-secret-do-not-use-in-prod';

/**
 * Create a signed session token.
 * Exported so the OAuth callback route can issue tokens after a successful
 * code exchange.
 */
export function createSessionToken(payload: Omit<SessionPayload, 'iat' | 'exp'>): string {
  // We use a simple HMAC-signed token rather than pulling in a full JWT lib.
  // The header and payload are base64url-encoded JSON; the signature is an
  // HMAC-SHA256 of the first two segments.
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 86_400; // 24 hours

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(
    JSON.stringify({ ...payload, iat: now, exp }),
  );

  const signature = createHmac(encodedHeader, encodedPayload);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a session token.  Returns null for any invalid or
 * expired token.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;

  // Verify signature
  const expectedSig = createHmac(encodedHeader, encodedPayload);
  if (!constantTimeEqual(signature, expectedSig)) return null;

  // Decode payload
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as SessionPayload;
  } catch {
    return null;
  }

  // Check expiration
  if (payload.exp * 1000 < Date.now()) return null;

  return payload;
}

// ---------------------------------------------------------------------------
// JWT session middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware — requires a valid session token.
 * Attaches `req.sessionUser` on success or returns 401.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const user = resolveSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.sessionUser = user;
  next();
}

/**
 * Express middleware — attaches `req.sessionUser` if a valid token is
 * present, but does not reject unauthenticated requests.
 */
export function optionalSession(req: Request, _res: Response, next: NextFunction): void {
  const user = resolveSessionUser(req);
  if (user) {
    req.sessionUser = user;
  }
  next();
}

// ---------------------------------------------------------------------------
// Combined auth middleware (API key + JWT)
// ---------------------------------------------------------------------------

/**
 * Express middleware — requires authentication via API key or JWT session.
 *
 * Tries API key first (fast, no crypto), then falls back to JWT session.
 * Returns 401 if neither method yields a valid identity.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Try API key
  const apiKey = req.headers[API_KEY_HEADER];
  if (apiKey && typeof apiKey === 'string') {
    const validKeys = getValidApiKeys();
    if (validKeys.length > 0 && validKeys.includes(apiKey)) {
      req.sessionUser = {
        id: 0,
        login: 'api-key',
        avatarUrl: null,
        method: 'api-key',
      };
      next();
      return;
    }
    // Invalid API key — return 401 immediately (don't fall through to JWT)
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // 2. Try JWT session
  const user = resolveSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.sessionUser = user;
  next();
}

/**
 * Express middleware — attaches user if authenticated via API key or JWT,
 * but does not reject unauthenticated requests.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  // 1. Try API key
  const apiKey = req.headers[API_KEY_HEADER];
  if (apiKey && typeof apiKey === 'string') {
    const validKeys = getValidApiKeys();
    if (validKeys.length > 0 && validKeys.includes(apiKey)) {
      req.sessionUser = {
        id: 0,
        login: 'api-key',
        avatarUrl: null,
        method: 'api-key',
      };
      next();
      return;
    }
    // Invalid key — silently ignore, don't block
  }

  // 2. Try JWT session
  const user = resolveSessionUser(req);
  if (user) {
    req.sessionUser = user;
  }
  next();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the AuthUser from the request — checks Cookie first, then
 * Authorization header.
 */
function resolveSessionUser(req: Request): AuthUser | null {
  // 1. Try cookie (browser-based dashboard)
  const cookieToken = parseCookies(req)?.['stas_token'];
  if (cookieToken) {
    const payload = verifySessionToken(cookieToken);
    if (payload) return payloadToUser(payload);
  }

  // 2. Try Authorization header (API clients)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const payload = verifySessionToken(authHeader.slice(7));
    if (payload) return payloadToUser(payload);
  }

  return null;
}

function payloadToUser(payload: SessionPayload): AuthUser {
  return {
    id: payload.sub,
    login: payload.login,
    avatarUrl: payload.avatarUrl,
    method: 'session',
  };
}

function parseCookies(req: Request): Record<string, string> | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}

function base64url(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createHmac(header: string, payload: string): string {
  const { createHmac: hm } = require('node:crypto') as typeof import('node:crypto');
  return hm('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
    .replace(/=+$/, '');
}

/**
 * Constant-time string comparison to prevent timing attacks on the
 * signature check.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Do not short-circuit — still iterate to keep time roughly constant
    let result = a.length ^ b.length;
    const maxLen = Math.max(a.length, b.length);
    const aPadded = a.padEnd(maxLen, '\x00');
    const bPadded = b.padEnd(maxLen, '\x00');
    for (let i = 0; i < maxLen; i++) {
      result |= aPadded.charCodeAt(i) ^ bPadded.charCodeAt(i);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
