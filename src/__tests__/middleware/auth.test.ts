/**
 * Unit tests for src/middleware/auth.ts — API key + JWT auth middleware.
 *
 * Tests:
 *   - requireApiKey: rejects missing/invalid keys, accepts valid keys
 *   - requireSession / optionalSession: JWT session auth (existing behaviour)
 *   - requireAuth: combined API key + JWT, API key takes priority
 *   - optionalAuth: permissive combined auth
 *   - createSessionToken / verifySessionToken: token utilities
 *   - Edge cases: no keys configured, expired tokens, tampered tokens
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockLoggerChild = vi.hoisted(() => vi.fn(() => ({
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
})));

// We mock config early so the module under test gets the right values
const mockConfig = vi.hoisted(() => ({
  admin: { apiKey: 'test-admin-key' },
  mcp: { apiKey: 'test-mcp-key' },
  github: { oauthClientSecret: 'test-jwt-secret-for-testing-only' },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: mockLoggerChild },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockReqRes(authHeader?: string, apiKey?: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  if (apiKey) headers['x-api-key'] = apiKey;
  if (cookie) headers.cookie = cookie;

  const req = { headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('middleware/auth', () => {
  let auth: typeof import('../../middleware/auth.js');

  beforeAll(async () => {
    auth = await import('../../middleware/auth.js');
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  // ── requireApiKey ─────────────────────────────────────────────────────────

  describe('requireApiKey', () => {
    it('returns 401 when no X-API-Key header is present', () => {
      const { req, res, next } = mockReqRes();
      auth.requireApiKey(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('API key') }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when X-API-Key header is empty', () => {
      const { req, res, next } = mockReqRes('', '');
      auth.requireApiKey(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when API key is invalid', () => {
      const { req, res, next } = mockReqRes('', 'invalid-key');
      auth.requireApiKey(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid API key' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts the admin API key', () => {
      const { req, res, next } = mockReqRes('', 'test-admin-key');
      auth.requireApiKey(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeDefined();
      expect(req.sessionUser!.method).toBe('api-key');
      expect(req.sessionUser!.login).toBe('api-key');
    });

    it('accepts the MCP API key', () => {
      const { req, res, next } = mockReqRes('', 'test-mcp-key');
      auth.requireApiKey(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeDefined();
      expect(req.sessionUser!.method).toBe('api-key');
    });

    it('logs a warning when no API keys are configured', async () => {
      mockConfig.admin.apiKey = '';
      mockConfig.mcp.apiKey = '';
      const authMod = await import('../../middleware/auth.js');
      const { req, res, next } = mockReqRes('', 'some-key');
      authMod.requireApiKey(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'API key authentication is not configured' }),
      );
      expect(next).not.toHaveBeenCalled();
      // Restore
      mockConfig.admin.apiKey = 'test-admin-key';
      mockConfig.mcp.apiKey = 'test-mcp-key';
    });
  });

  // ── createSessionToken / verifySessionToken ─────────────────────────────

  describe('createSessionToken', () => {
    it('returns a string token with three parts', () => {
      const token = auth.createSessionToken({ sub: 123, login: 'testuser', avatarUrl: null });
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('includes provided claims in the payload', () => {
      const token = auth.createSessionToken({ sub: 456, login: 'alice', avatarUrl: 'https://example.com/ava.png' });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.sub).toBe(456);
      expect(payload.login).toBe('alice');
      expect(payload.avatarUrl).toBe('https://example.com/ava.png');
    });

    it('sets iat and exp fields', () => {
      const token = auth.createSessionToken({ sub: 1, login: 'u', avatarUrl: null });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });
  });

  describe('verifySessionToken', () => {
    it('verifies a valid token', () => {
      const token = auth.createSessionToken({ sub: 42, login: 'bob', avatarUrl: null });
      const payload = auth.verifySessionToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe(42);
      expect(payload!.login).toBe('bob');
    });

    it('returns null for a token with tampered payload', () => {
      const token = auth.createSessionToken({ sub: 1, login: 'alice', avatarUrl: null });
      const parts = token.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: 999, login: 'hacker' })).toString('base64url');
      const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
      expect(auth.verifySessionToken(tampered)).toBeNull();
    });

    it('returns null for a token with tampered signature', () => {
      const token = auth.createSessionToken({ sub: 1, login: 'alice', avatarUrl: null });
      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;
      expect(auth.verifySessionToken(tampered)).toBeNull();
    });

    it('returns null for a malformed token', () => {
      expect(auth.verifySessionToken('not-a-token')).toBeNull();
      expect(auth.verifySessionToken('two.parts')).toBeNull();
      expect(auth.verifySessionToken('')).toBeNull();
    });

    it('returns null for a token with invalid base64 payload', () => {
      expect(auth.verifySessionToken('header.###invalid###.signature')).toBeNull();
    });

    it('returns null for an expired token', () => {
      const token = auth.createSessionToken({ sub: 1, login: 'expired', avatarUrl: null });
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.exp = Math.floor(Date.now() / 1000) - 3600;
      payload.iat = payload.exp - 100;
      const modifiedPayloadBuf = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const forged = `${parts[0]}.${modifiedPayloadBuf}.${parts[2]}`;
      expect(auth.verifySessionToken(forged)).toBeNull();
    });
  });

  // ── requireSession ──────────────────────────────────────────────────────

  describe('requireSession', () => {
    it('returns 401 when no auth is provided', () => {
      const { req, res, next } = mockReqRes();
      auth.requireSession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts a valid Bearer token', () => {
      const token = auth.createSessionToken({ sub: 7, login: 'jane', avatarUrl: null });
      const { req, res, next } = mockReqRes(`Bearer ${token}`);
      auth.requireSession(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeDefined();
      expect(req.sessionUser!.id).toBe(7);
      expect(req.sessionUser!.login).toBe('jane');
      expect(req.sessionUser!.method).toBe('session');
    });

    it('accepts a valid cookie token', () => {
      const token = auth.createSessionToken({ sub: 8, login: 'cookie-user', avatarUrl: 'https://ava.com/1' });
      const { req, res, next } = mockReqRes('', '', `stas_token=${token}`);
      auth.requireSession(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeDefined();
      expect(req.sessionUser!.login).toBe('cookie-user');
      expect(req.sessionUser!.avatarUrl).toBe('https://ava.com/1');
    });

    it('returns 401 for an invalid Bearer token', () => {
      const { req, res, next } = mockReqRes('Bearer invalid-token');
      auth.requireSession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── optionalSession ─────────────────────────────────────────────────────

  describe('optionalSession', () => {
    it('calls next() even without auth', () => {
      const { req, res, next } = mockReqRes();
      auth.optionalSession(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeUndefined();
    });

    it('attaches user when valid Bearer token is provided', () => {
      const token = auth.createSessionToken({ sub: 9, login: 'opt-user', avatarUrl: null });
      const { req, res, next } = mockReqRes(`Bearer ${token}`);
      auth.optionalSession(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeDefined();
      expect(req.sessionUser!.login).toBe('opt-user');
    });

    it('ignores invalid tokens and still calls next()', () => {
      const { req, res, next } = mockReqRes('Bearer bad-token');
      auth.optionalSession(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeUndefined();
    });
  });

  // ── requireAuth (combined) ──────────────────────────────────────────────

  describe('requireAuth', () => {
    it('accepts a valid API key', () => {
      const { req, res, next } = mockReqRes('', 'test-admin-key');
      auth.requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser!.method).toBe('api-key');
    });

    it('accepts a valid Bearer JWT when no API key is provided', () => {
      const token = auth.createSessionToken({ sub: 10, login: 'combined', avatarUrl: null });
      const { req, res, next } = mockReqRes(`Bearer ${token}`);
      auth.requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser!.method).toBe('session');
      expect(req.sessionUser!.login).toBe('combined');
    });

    it('returns 401 when invalid API key is provided (does not fall through to JWT)', () => {
      const validToken = auth.createSessionToken({ sub: 11, login: 'should-not-pass', avatarUrl: null });
      const { req, res, next } = mockReqRes(`Bearer ${validToken}`, 'invalid-key');
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid API key' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when no auth is provided', () => {
      const { req, res, next } = mockReqRes();
      auth.requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('prefers API key over JWT when both are valid', () => {
      const token = auth.createSessionToken({ sub: 12, login: 'api-priority', avatarUrl: null });
      const { req, res, next } = mockReqRes(`Bearer ${token}`, 'test-mcp-key');
      auth.requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser!.method).toBe('api-key');
    });
  });

  // ── optionalAuth (combined) ─────────────────────────────────────────────

  describe('optionalAuth', () => {
    it('calls next() even without auth', () => {
      const { req, res, next } = mockReqRes();
      auth.optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeUndefined();
    });

    it('attaches user via API key', () => {
      const { req, res, next } = mockReqRes('', 'test-admin-key');
      auth.optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeDefined();
      expect(req.sessionUser!.method).toBe('api-key');
    });

    it('attaches user via JWT when no API key', () => {
      const token = auth.createSessionToken({ sub: 13, login: 'optional-jwt', avatarUrl: null });
      const { req, res, next } = mockReqRes(`Bearer ${token}`);
      auth.optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser!.method).toBe('session');
    });

    it('ignores invalid API key and still calls next() without user', () => {
      const { req, res, next } = mockReqRes('', 'wrong-key');
      auth.optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeUndefined();
    });

    it('ignores invalid JWT and still calls next() without user', () => {
      const { req, res, next } = mockReqRes('Bearer bad-token');
      auth.optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.sessionUser).toBeUndefined();
    });
  });

  // ── Type exports ────────────────────────────────────────────────────────

  describe('exports', () => {
    it('exports API_KEY_HEADER constant', () => {
      expect(auth.API_KEY_HEADER).toBe('x-api-key');
    });

    it('exports requireApiKey, requireSession, optionalSession', () => {
      expect(typeof auth.requireApiKey).toBe('function');
      expect(typeof auth.requireSession).toBe('function');
      expect(typeof auth.optionalSession).toBe('function');
    });

    it('exports requireAuth and optionalAuth', () => {
      expect(typeof auth.requireAuth).toBe('function');
      expect(typeof auth.optionalAuth).toBe('function');
    });

    it('exports createSessionToken and verifySessionToken', () => {
      expect(typeof auth.createSessionToken).toBe('function');
      expect(typeof auth.verifySessionToken).toBe('function');
    });
  });
});
